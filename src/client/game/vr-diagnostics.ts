import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { WebXRTrackingState } from '@babylonjs/core/XR/webXRTypes';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import type { WebXRRenderTarget } from '@babylonjs/core/XR/webXRTypes';
import { version } from '../../../package.json';
import { isFatalXRGlError, xrHealthFailure } from './vr-health';

type Context = WebGLRenderingContext | WebGL2RenderingContext;
type Viewport = [number, number, number, number];

export interface VRDiagnosticReport {
  version: string;
  state: 'idle' | 'requested' | 'presenting' | 'ended' | 'failed';
  elapsedMs: number;
  nativeFrames: number;
  validPoseFrames: number;
  drawFrames: number;
  eyeDrawPasses: number;
  drawCalls: number;
  eyes: number;
  outputTargets: number;
  framebufferWidth: number;
  framebufferHeight: number;
  framebufferStatus: number | null;
  targetMatches: boolean | null;
  opaqueFramebuffer: boolean | null;
  viewports: Record<string, Viewport>;
  glErrors: number[];
  priorGlErrors: number[];
  visibility: string;
  lastFailure: string | null;
  context: WebGLContextAttributes | null;
  ignoreDepthValues: boolean | null;
}

function emptyReport(): VRDiagnosticReport {
  return {
    version, state: 'idle', elapsedMs: 0, nativeFrames: 0, validPoseFrames: 0, drawFrames: 0,
    eyeDrawPasses: 0, drawCalls: 0, eyes: 0, outputTargets: 0,
    framebufferWidth: 0, framebufferHeight: 0, framebufferStatus: null,
    targetMatches: null, opaqueFramebuffer: null, viewports: {}, glErrors: [], priorGlErrors: [],
    visibility: 'unstarted', lastFailure: null, context: null, ignoreDepthValues: null,
  };
}

/** Records only render health. It stores no room IDs, physical head poses or URLs. */
export class VRDiagnostics {
  private report = emptyReport();
  private helper: WebXRExperienceHelper | null = null;
  private target: WebXRRenderTarget | null = null;
  private session: XRSession | null = null;
  private instrumentation: SceneInstrumentation | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private endedAt = 0;
  private visibleSince = 0;
  private lastFrameAt = 0;
  private lastPoseAt = 0;
  private lastDrawAt = 0;
  private lastDrawnFrame = -1;
  private drawBaseline = 0;
  private sampleFrame = -1;
  private lastSampleAt = 0;
  private readonly gl: Context | null;
  private readonly beforeDraw: Observer<Scene>;
  private readonly afterDraw: Observer<Scene>;

  constructor(private readonly scene: Scene, private readonly fail: (message: string) => void) {
    const canvas = scene.getEngine().getRenderingCanvas();
    this.gl = canvas ? canvas.getContext('webgl2') ?? canvas.getContext('webgl') : null;
    this.beforeDraw = scene.onBeforeDrawPhaseObservable.add(() => {
      if (this.isEyeDraw()) this.drawBaseline = this.instrumentation?.drawCallsCounter.current ?? 0;
    });
    this.afterDraw = scene.onAfterDrawPhaseObservable.add(() => this.afterEyeDraw());
  }

  request(): void {
    this.stop();
    this.report = emptyReport();
    this.report.state = 'requested';
    this.startedAt = performance.now(); this.endedAt = 0;
    this.visibleSince = 0; this.lastFrameAt = 0; this.lastPoseAt = 0; this.lastDrawAt = 0;
    this.lastDrawnFrame = -1; this.sampleFrame = -1; this.lastSampleAt = 0;
    this.report.context = this.gl?.getContextAttributes() ?? null;
    if (this.gl) for (let count = 0; count < 8; count += 1) {
      const error = this.gl.getError();
      if (error === this.gl.NO_ERROR) break;
      this.report.priorGlErrors.push(error);
    }
  }

  start(session: XRSession, helper: WebXRExperienceHelper, target: WebXRRenderTarget): void {
    this.session = session; this.helper = helper; this.target = target;
    this.report.state = 'presenting';
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.visibility(session.visibilityState);
    this.interval = setInterval(() => this.check(), 500);
  }

  visibility(value: string): void {
    if (this.report.visibility !== value) {
      this.report.visibility = value;
      if (value === 'visible') this.visibleSince = performance.now();
    }
  }

  frame(): void {
    if (!this.session) return;
    this.visibility(this.session.visibilityState);
    this.report.nativeFrames += 1; this.lastFrameAt = performance.now();
  }

  pose(camera: WebXRCamera): void {
    if (!this.session) return;
    this.report.eyes = camera.rigCameras.length;
    this.report.outputTargets = camera.rigCameras.filter((eye) => Boolean(eye.outputRenderTarget)).length;
    if (camera.trackingState !== WebXRTrackingState.NOT_TRACKING) {
      this.report.validPoseFrames += 1; this.lastPoseAt = performance.now();
    }
  }

  failure(message: string): void { this.report.lastFailure = message; this.report.state = 'failed'; }

  compact(): string {
    return `XR frames=${this.report.nativeFrames}, poses=${this.report.validPoseFrames}, draws=${this.report.drawFrames}, eyes=${this.report.eyes}, targets=${this.report.outputTargets}, GL=${this.report.glErrors.map((code) => `0x${code.toString(16)}`).join(',') || '0'}, FBO=${this.report.framebufferStatus === null ? 'unseen' : `0x${this.report.framebufferStatus.toString(16)}`}, visibility=${this.report.visibility}`;
  }

  getReport(): string {
    const elapsedMs = this.startedAt > 0 ? Math.round((this.endedAt || performance.now()) - this.startedAt) : 0;
    return JSON.stringify({ ...this.report, elapsedMs }, null, 2);
  }

  stop(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (this.startedAt > 0 && this.endedAt === 0) this.endedAt = performance.now();
    if (this.session) {
      if (this.report.lastFailure === null) this.report.state = 'ended';
    }
    this.session = null; this.helper = null; this.target = null;
    this.instrumentation?.dispose(); this.instrumentation = null;
  }

  dispose(): void {
    this.stop();
    this.scene.onBeforeDrawPhaseObservable.remove(this.beforeDraw);
    this.scene.onAfterDrawPhaseObservable.remove(this.afterDraw);
  }

  private isEyeDraw(): boolean {
    if (!this.session || !this.helper?.sessionManager.inXRFrameLoop) return false;
    const camera = this.scene.activeCamera;
    return !!camera?.outputRenderTarget && (camera === this.helper.camera || camera.rigParent === this.helper.camera);
  }

  private afterEyeDraw(): void {
    if (!this.isEyeDraw()) return;
    const now = performance.now();
    const calls = Math.max(0, (this.instrumentation?.drawCallsCounter.current ?? 0) - this.drawBaseline);
    this.report.eyeDrawPasses += 1; this.report.drawCalls += calls;
    const layer = this.target?.xrLayer;
    if (layer) {
      this.report.framebufferWidth = layer.framebufferWidth; this.report.framebufferHeight = layer.framebufferHeight;
      this.report.ignoreDepthValues = layer.ignoreDepthValues;
    }
    if (this.gl && (this.report.nativeFrames <= 3 || now - this.lastSampleAt >= 1000)) {
      this.sampleFrame = this.report.nativeFrames; this.lastSampleAt = now;
    }
    if (this.gl && this.sampleFrame === this.report.nativeFrames) {
      const bound: unknown = this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING);
      this.report.targetMatches = layer ? bound === layer.framebuffer : null;
      this.report.opaqueFramebuffer = layer ? layer.framebuffer !== null : null;
      // This callback runs inside the session's XR RAF with its framebuffer
      // bound. Opaque attachments are never inspected, changed or read back.
      this.report.framebufferStatus = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
      const viewport: unknown = this.gl.getParameter(this.gl.VIEWPORT);
      if (viewport instanceof Int32Array) {
        const eye = this.scene.activeCamera?.isLeftCamera ? 'left' : this.scene.activeCamera?.isRightCamera ? 'right' : 'view';
        this.report.viewports[eye] = [viewport[0] ?? 0, viewport[1] ?? 0, viewport[2] ?? 0, viewport[3] ?? 0];
      }
      for (let index = 0; index < 8; index += 1) {
        const error = this.gl.getError();
        if (error === this.gl.NO_ERROR) break;
        if (this.report.glErrors.length < 8 && !this.report.glErrors.includes(error)) this.report.glErrors.push(error);
      }
    }
    if (calls > 0 && this.report.outputTargets > 0 && this.report.targetMatches !== false) {
      this.lastDrawAt = now;
      if (this.lastDrawnFrame !== this.report.nativeFrames) { this.lastDrawnFrame = this.report.nativeFrames; this.report.drawFrames += 1; }
    }
    this.check();
  }

  private check(): void {
    if (!this.session) return;
    const reason = xrHealthFailure({
      visible: this.session.visibilityState === 'visible', visibleSince: this.visibleSince,
      lastFrameAt: this.lastFrameAt, lastPoseAt: this.lastPoseAt, lastDrawAt: this.lastDrawAt,
      glError: this.report.glErrors.find(isFatalXRGlError) ?? this.report.glErrors[0] ?? 0, framebufferStatus: this.report.framebufferStatus,
      targetMatches: this.report.targetMatches,
    }, performance.now());
    if (reason) {
      this.failure(reason);
      if (this.interval !== null) clearInterval(this.interval);
      this.interval = null;
      this.fail(reason);
    }
  }
}
