import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import { WebXRInput } from '@babylonjs/core/XR/webXRInput';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
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

export const VR_FEET_PER_METER = 3.28084;
const EYE_HEIGHT = 5.3;

export interface VRRig {
  readonly active: boolean;
  readonly focused: boolean;
  readonly camera: Camera;
  enter(): Promise<void>;
  exit(): Promise<void>;
  recenter(): void;
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
  let match: MatchState | null = null;
  let stationSlot = 0;
  let disposed = false;
  let entering = false;
  let baseline = true;
  let held = new Set<string>();
  let removeVisibilityListener: (() => void) | null = null;
  let status: VRStatus = { kind: 'checking' };

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
  function focused(): boolean {
    return active() && helper?.state === WebXRState.IN_XR && helper.sessionManager.session.visibilityState === 'visible';
  }

  function placeAtStation(camera: WebXRCamera, height: number): void {
    // Stand between cage posts and face the center from either team's side.
    const x = stationSlot === 0 ? -4 : 4;
    const z = stationSlot === 0 ? -29 : 29;
    camera.position.set(x, height, z);
    camera.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(Math.atan2(-x, -z), 0, 0));
  }

  function recenter(): void {
    if (!helper || !active()) return;
    neutral();
    // Babylon converts changes to this tracked pose into a reference-space offset
    // on its next XR frame. Set the desired eye pose directly, without resetting
    // its first-frame height compensation or overriding subsequent head tracking.
    placeAtStation(helper.camera, EYE_HEIGHT);
    helper.camera.getViewMatrix(true);
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
      const experience = await WebXRExperienceHelper.CreateAsync(scene);
      if (disposed) { experience.dispose(); return; }
      helper = experience;
      helper.sessionManager.worldScalingFactor = VR_FEET_PER_METER;
      helper.camera.minZ = 0.12; helper.camera.maxZ = 200;
      input = new WebXRInput(helper.sessionManager, helper.camera, {
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
        canvasOptions: { framebufferScaleFactor: 0.85, antialias: true, alpha: false, depth: true, stencil: false },
      });
      helper.onInitialXRPoseSetObservable.add((camera) => {
        placeAtStation(camera, 0);
      });
      helper.onStateChangedObservable.add((state) => {
        if (disposed) return;
        if (state === WebXRState.IN_XR) {
          recenter();
          report({ kind: focused() ? 'active' : 'paused' });
        } else if (state === WebXRState.ENTERING_XR) {
          neutral(); report({ kind: 'entering' });
        } else if (state === WebXRState.NOT_IN_XR) {
          neutral(); entering = false;
          removeVisibilityListener?.(); removeVisibilityListener = null;
          scene.activeCamera = desktopCamera;
          report({ kind: 'available' });
        } else {
          neutral(); report({ kind: 'paused' });
        }
      });
      helper.sessionManager.onXRSessionInit.add((session) => {
        const visibility = () => {
          neutral();
          report({ kind: helper?.state !== WebXRState.IN_XR ? 'entering' : session.visibilityState === 'visible' ? 'active' : 'paused' });
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
      try {
        await helper.enterXRAsync('immersive-vr', 'local-floor', renderTarget, { optionalFeatures: ['local-floor', 'hand-tracking'] });
      } catch (cause: unknown) {
        entering = false; neutral();
        report({ kind: 'available' });
        throw cause instanceof Error ? cause : new Error('VR entry was cancelled or unavailable.');
      }
    },
    async exit() {
      neutral();
      if (helper && active()) await helper.exitXRAsync();
    },
    recenter,
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
      if (helper && active()) void helper.exitXRAsync().catch(() => undefined);
      input?.dispose(); input = null;
      renderTarget?.dispose(); renderTarget = null;
      helper?.featuresManager.dispose(); helper?.dispose(); helper = null; selection = null;
    },
  };
}
