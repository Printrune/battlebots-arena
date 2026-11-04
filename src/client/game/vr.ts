import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import { WebXRInput } from '@babylonjs/core/XR/webXRInput';
import { WebXRState, WebXRTrackingState } from '@babylonjs/core/XR/webXRTypes';
import { WebXRControllerPointerSelection } from '@babylonjs/core/XR/features/WebXRControllerPointerSelection';
import '@babylonjs/core/XR/motionController/webXRMotionControllerManager';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { WebXRRenderTarget } from '@babylonjs/core/XR/webXRTypes';
import type { MatchState } from '../../shared/protocol';
import type { VRCallbacks, VRStatus } from '../../shared/vr';
import { readVRInput } from './vr-input';
import type { VRControllerSample } from './vr-input';
import { VRDiagnostics } from './vr-diagnostics';
import { attachVRLayers, prepareVRLayers } from './vr-layers';

export const VR_FEET_PER_METER = 3.28084;
export const VR_CONTROLLER_PROFILE = 'generic-trigger';
const EYE_HEIGHT = 5.3;

/** Place the tracking origin, leaving native headset/eye poses untouched. */
export function alignVRStation(camera: WebXRCamera, origin: TransformNode, slot: number): void {
  const x = slot === 0 ? -4 : 4;
  const z = slot === 0 ? -29 : 29;
  const heading = Math.atan2(-x, -z);
  origin.rotationQuaternion ??= Quaternion.Identity();
  Quaternion.RotationYawPitchRollToRef(heading - camera.rotationQuaternion.toEulerAngles().y, 0, 0, origin.rotationQuaternion);
  const headOffset = Vector3.Zero();
  camera.position.rotateByQuaternionToRef(origin.rotationQuaternion, headOffset);
  origin.position.set(x - headOffset.x, EYE_HEIGHT - headOffset.y, z - headOffset.z);
  origin.computeWorldMatrix(true);
  camera.getViewMatrix(true);
}

export interface VRRig {
  readonly active: boolean;
  readonly focused: boolean;
  readonly camera: Camera;
  enter(): Promise<void>;
  exit(): Promise<void>;
  recenter(): void;
  getReport(): string;
  pulse(dt: number): void;
  setMatch(snapshot: MatchState | null, localId: string | null): void;
  dispose(): void;
}

export interface VRRigCallbacks extends VRCallbacks {
  onInputLost?(): void;
}

/** WebXR owns the headset pose. Combat never moves or shakes this camera. */
export function createVR(scene: Scene, desktopCamera: Camera, callbacks: VRRigCallbacks): VRRig {
  let helper: WebXRExperienceHelper | null = null;
  let input: WebXRInput | null = null;
  let selection: WebXRControllerPointerSelection | null = null;
  let renderTarget: WebXRRenderTarget | null = null;
  let projectionDepth: Pick<XRProjectionLayerInit, 'depthFormat'> = { depthFormat: 0x1902 };
  let match: MatchState | null = null;
  let stationSlot = 0;
  let disposed = false;
  let entering = false;
  let recoveringFromFailure = false;
  let baseline = true;
  let awaitingTrackedAnchor = true;
  let held = new Set<string>();
  let removeVisibilityListener: (() => void) | null = null;
  let removeFailureListeners: (() => void) | null = null;
  let status: VRStatus = { kind: 'checking' };
  const diagnostics = new VRDiagnostics(scene, (message) => { void recover(new Error(message)); });
  const origin = new TransformNode('vr-tracking-origin', scene);
  const contextLost = scene.getEngine().onContextLostObservable.add(() => {
    void recover(new Error('The graphics context was lost while rendering VR.'));
  });

  function report(next: VRStatus): void {
    status = next;
    if (!disposed) callbacks.onStatus(next);
  }

  function neutral(): void {
    baseline = true;
    held.clear();
    if (!disposed) { callbacks.onDrive(0, 0); callbacks.onInputLost?.(); }
  }

  function active(): boolean { return helper?.sessionManager.inXRSession ?? false; }
  function hasPose(): boolean { return !!helper && helper.camera.trackingState !== WebXRTrackingState.NOT_TRACKING; }
  function focused(): boolean {
    return active() && hasPose() && helper?.state === WebXRState.IN_XR && helper.sessionManager.session.visibilityState === 'visible';
  }

  function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'An unexpected error stopped VR rendering.';
  }

  async function endSession(): Promise<void> {
    if (!helper || !active()) return;
    try {
      await helper.exitXRAsync();
    } finally {
      // The helper can still be entering when its first camera/framebuffer update
      // throws. End that created session even if the helper did not reach IN_XR.
      if (active()) await helper.sessionManager.exitXRAsync();
    }
  }

  async function recover(cause: unknown): Promise<void> {
    if (disposed || recoveringFromFailure || !active() && !entering) return;
    recoveringFromFailure = true;
    const message = errorMessage(cause);
    diagnostics.failure(message);
    console.error({ event: 'vr_render_failed', message });
    try {
      neutral();
    } catch (resetFailure: unknown) {
      console.error({ event: 'vr_input_reset_failed', message: errorMessage(resetFailure) });
    }
    try {
      await endSession();
    } catch (exitFailure: unknown) {
      console.error({ event: 'vr_exit_failed', message: errorMessage(exitFailure) });
    } finally {
      entering = false;
      diagnostics.stop();
      removeFailureListeners?.(); removeFailureListeners = null;
      if (!active()) { scene.activeCamera = desktopCamera; report({ kind: 'available' }); }
      else report({ kind: 'paused' });
      recoveringFromFailure = false;
      if (!disposed) callbacks.onError?.(`VR stopped because of a rendering error: ${message} ${diagnostics.compact()}`);
    }
  }

  function watchForFailures(): void {
    if (typeof window === 'undefined' || removeFailureListeners) return;
    const onError = (event: ErrorEvent) => {
      // Resource load events have no JS ErrorEvent payload and must not end VR.
      if (event instanceof ErrorEvent && event.message) void recover(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => { void recover(event.reason); };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    removeFailureListeners = () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }

  function recenter(): void {
    if (!helper || !active()) return;
    neutral();
    if (!hasPose()) { awaitingTrackedAnchor = true; return; }
    alignVRStation(helper.camera, origin, stationSlot);
    awaitingTrackedAnchor = false;
  }

  function sample(controller: WebXRInputSource): VRControllerSample {
    const gamepad = controller.inputSource.gamepad;
    const motion = controller.motionController;
    const component = motion?.getComponentOfType('thumbstick') ?? motion?.getComponentOfType('touchpad');
    const axes = gamepad?.axes ?? [];
    const fallbackOffset = axes.length >= 4 ? 2 : 0;
    const fallback = { x: axes[fallbackOffset] ?? 0, y: axes[fallbackOffset + 1] ?? 0 };
    if (fallback.x === 0 && fallback.y === 0 && axes.length >= 4) {
      fallback.x = axes[0] ?? 0; fallback.y = axes[1] ?? 0;
    }
    const components = motion?.components;
    const handedness = controller.inputSource.handedness;
    const primary = components?.[handedness === 'left' ? 'x-button' : 'a-button'];
    const secondary = components?.[handedness === 'left' ? 'y-button' : 'b-button'];
    const trigger = motion?.getComponentOfType('trigger');
    const metadata: unknown = selection?.getMeshUnderPointer(controller.uniqueId)?.metadata;
    const onHud = typeof metadata === 'object' && metadata !== null && 'vrControl' in metadata && metadata.vrControl === true;
    return {
      id: controller.uniqueId, handedness,
      stick: component?.axes ?? fallback,
      trigger: trigger?.pressed ?? gamepad?.buttons[0]?.pressed ?? false,
      primary: primary?.pressed ?? gamepad?.buttons[4]?.pressed ?? false,
      secondary: secondary?.pressed ?? gamepad?.buttons[5]?.pressed ?? false,
      onHud,
    };
  }

  async function prepare(): Promise<void> {
    report({ kind: 'checking' });
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      report({ kind: 'unavailable', reason: 'VR needs an HTTPS address. Open the secure game link in your headset browser.' });
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.xr) {
      report({ kind: 'unavailable', reason: 'Open this game in a browser with immersive WebXR support.' });
      return;
    }
    try {
      if (!await navigator.xr.isSessionSupported('immersive-vr')) {
        report({ kind: 'unavailable', reason: 'This browser is not connected to a supported VR headset.' });
        return;
      }
      if (disposed) return;
      const canvas = scene.getEngine().getRenderingCanvas();
      const gl = canvas ? canvas.getContext('webgl2') ?? canvas.getContext('webgl') : null;
      if (gl) {
        // Layers attach during session initialization, before the legacy output
        // canvas awaits compatibility. Finish it while preparing the VR button.
        if (typeof gl.makeXRCompatible === 'function') await gl.makeXRCompatible();
        projectionDepth = { depthFormat: 'texImage3D' in gl ? 0x81a6 : 0x1902 };
      }
      if (disposed) return;
      const experience = await WebXRExperienceHelper.CreateAsync(scene);
      if (disposed) { experience.dispose(); return; }
      helper = experience;
      helper.camera.parent = origin;
      helper.sessionManager.worldScalingFactor = VR_FEET_PER_METER;
      helper.camera.minZ = 0.12; helper.camera.maxZ = 200;
      input = new WebXRInput(helper.sessionManager, helper.camera, {
        forceInputProfile: VR_CONTROLLER_PROFILE,
        doNotLoadControllerMeshes: true,
        disableControllerAnimation: true,
        disableOnlineControllerRepository: true,
      });
      selection = helper.featuresManager.enableFeature(WebXRControllerPointerSelection.Name, 'stable', {
        xrInput: input,
        enablePointerSelectionOnAllControllers: true,
        disableScenePointerVectorUpdate: true,
        disablePointerUpOnTouchOut: false,
        forceGazeMode: false,
        useUtilityLayer: false,
        maxPointerDistance: 24,
      });
      selection.raySelectionPredicate = (mesh) => {
        const metadata: unknown = mesh.metadata;
        return mesh.isEnabled() && mesh.isPickable && typeof metadata === 'object' && metadata !== null &&
          'vrControl' in metadata && metadata.vrControl === true;
      };
      selection.disablePointerLighting = true;
      selection.disableSelectionMeshLighting = true;
      renderTarget = helper.sessionManager.getWebXRRenderTarget({
        canvasElement: scene.getEngine().getRenderingCanvas() ?? undefined,
        // The HUD clears scene depth for its overlay pass, so it is not valid
        // compositor reprojection depth. Keep depth testing local to rendering.
        canvasOptions: { framebufferScaleFactor: 0.85, antialias: true, alpha: false, depth: true, stencil: false, ignoreDepthValues: true },
      });
      helper.onInitialXRPoseSetObservable.add((camera) => {
        // The helper copies the desktop camera before the first tracked frame.
        // Keep tracking local; the parent is positioned once that pose exists.
        camera.position.setAll(0);
        camera.rotationQuaternion.set(0, 0, 0, 1);
        awaitingTrackedAnchor = true;
      });
      helper.sessionManager.onXRFrameObservable.add(() => {
        if (!helper || disposed) return;
        diagnostics.pose(helper.camera);
        if (helper.state !== WebXRState.IN_XR) return;
        // An immersive session can start before tracking yields a viewer pose.
        // Anchor only once that pose exists, then keep ordinary tracking local.
        if (awaitingTrackedAnchor && hasPose()) recenter();
        const kind = focused() ? 'active' : 'paused';
        if (status.kind !== kind) {
          if (kind === 'paused') neutral();
          report({ kind });
        }
      });
      helper.sessionManager.onXRFrameObservable.add(() => diagnostics.frame(), undefined, true);
      helper.onStateChangedObservable.add((state) => {
        if (disposed) return;
        if (state === WebXRState.IN_XR) {
          recenter();
          report({ kind: focused() ? 'active' : 'paused' });
        } else if (state === WebXRState.ENTERING_XR) {
          neutral(); report({ kind: 'entering' });
        } else if (state === WebXRState.NOT_IN_XR) {
          diagnostics.stop();
          neutral(); entering = false;
          removeVisibilityListener?.(); removeVisibilityListener = null;
          removeFailureListeners?.(); removeFailureListeners = null;
          scene.activeCamera = desktopCamera;
          report({ kind: 'available' });
        } else {
          neutral(); report({ kind: 'paused' });
        }
      });
      helper.sessionManager.onXRSessionInit.add((session) => {
        if (helper) {
          attachVRLayers(helper.featuresManager);
          diagnostics.start(session, helper);
        }
        const visibility = () => {
          diagnostics.visibility(session.visibilityState);
          neutral();
          report({ kind: helper?.state !== WebXRState.IN_XR ? 'entering' : focused() ? 'active' : 'paused' });
        };
        removeVisibilityListener?.();
        // Babylon may omit its pointer-up when a ray leaves all pickable meshes.
        // Native selectend still releases held dashboard controls in that case.
        const releaseSelection = () => callbacks.onInputLost?.();
        session.addEventListener('visibilitychange', visibility);
        session.addEventListener('selectend', releaseSelection);
        removeVisibilityListener = () => {
          session.removeEventListener('visibilitychange', visibility);
          session.removeEventListener('selectend', releaseSelection);
        };
      });
      input.onControllerRemovedObservable.add(() => neutral());
      report({ kind: 'available' });
    } catch (cause: unknown) {
      input?.dispose(); input = null;
      renderTarget?.dispose(); renderTarget = null;
      helper?.featuresManager.dispose(); helper?.dispose(); helper = null; selection = null;
      origin.dispose();
      report({ kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'The VR session could not initialize in this browser.' });
    }
  }

  const prepared = prepare();
  return {
    get active() { return active(); },
    get focused() { return focused(); },
    get camera() { return active() && helper ? helper.camera : desktopCamera; },
    async enter() {
      await prepared;
      if (disposed || active() || entering) return;
      if (!helper || !renderTarget) throw new Error(status.kind === 'unavailable' ? status.reason : 'VR is not ready yet.');
      entering = true;
      diagnostics.request();
      watchForFailures();
      try {
        prepareVRLayers(helper.featuresManager, projectionDepth);
        await helper.enterXRAsync('immersive-vr', 'local-floor', renderTarget, { optionalFeatures: ['local-floor', 'hand-tracking'] });
        diagnostics.renderingReady();
      } catch (cause: unknown) {
        diagnostics.failure(errorMessage(cause));
        try {
          await endSession();
        } catch (exitFailure: unknown) {
          console.error({ event: 'vr_exit_failed', message: errorMessage(exitFailure) });
        } finally {
          diagnostics.stop();
          entering = false; neutral();
          removeFailureListeners?.(); removeFailureListeners = null;
          if (!active()) { scene.activeCamera = desktopCamera; report({ kind: 'available' }); }
          else report({ kind: 'paused' });
        }
        throw cause instanceof Error ? cause : new Error('VR entry was cancelled or unavailable.');
      }
    },
    async exit() {
      neutral();
      await endSession();
    },
    recenter,
    getReport() { return diagnostics.getReport(); },
    pulse(_dt) {
      if (disposed || !active() || !input) return;
      const enabled = focused();
      const samples = input.controllers.map(sample);
      const frame = readVRInput(samples, held, enabled && !baseline);
      held = frame.held;
      baseline = !enabled;
      callbacks.onDrive(frame.throttle, frame.steer);
      for (const action of frame.actions) {
        if (action === 'weapon' && match?.phase.kind === 'lobby') callbacks.onAction('ready');
        else if (action === 'weapon' && match?.phase.kind === 'finished') callbacks.onAction('rematch');
        else if (action === 'recenter') { recenter(); callbacks.onAction(action); }
        else callbacks.onAction(action);
      }
    },
    setMatch(snapshot, localId) {
      match = snapshot;
      const slot = snapshot?.players.find((player) => player.id === localId)?.spawnSlot ?? 0;
      if (slot !== stationSlot) { stationSlot = slot; recenter(); }
    },
    dispose() {
      if (disposed) return;
      neutral(); disposed = true;
      removeVisibilityListener?.(); removeVisibilityListener = null;
      removeFailureListeners?.(); removeFailureListeners = null;
      scene.getEngine().onContextLostObservable.remove(contextLost);
      diagnostics.dispose();
      if (helper && active()) void helper.exitXRAsync().catch(() => undefined);
      input?.dispose(); input = null;
      renderTarget?.dispose(); renderTarget = null;
      helper?.featuresManager.dispose(); helper?.dispose(); helper = null; selection = null;
      origin.dispose();
    },
  };
}
