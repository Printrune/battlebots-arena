import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { ARENA, BOTS, NEUTRAL_INPUT, driveVelocity, type ArenaRenderer, type BotId, type MatchState, type PaintId, type PlayerInput, type PlayerSnapshot } from '../../shared/protocol';
import { makeBot, material, type BotModel } from './models';
import { makeStage } from './stage';
import { ArenaSound } from './sound';
import { createArenaEnvironment } from './lighting';
import { damagedDriveTuning } from '../../shared/damage';
import { DebrisRenderer } from './debris';
import { PHYSICS } from '../../shared/physics';
import { followHeading, predictMotionToRef } from './motion';
import { createLifeBars } from './life-bars';
import { createExplosions } from './explosions';
import { DEFEAT_REVEAL_SECONDS } from '../../shared/presentation';
import { steeringForDrive } from '../../shared/driving';

interface DisplayBot {
  model: BotModel;
  state: PlayerSnapshot | null;
  weaponBlur: Mesh;
  displayedHealth: number;
  damageRevision: number;
  cameraYaw: number | null;
  bounds: Vector3[];
}

interface Spark {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
}

export async function createArena(canvas: HTMLCanvasElement): Promise<ArenaRenderer> {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance',
    adaptToDeviceRatio: false, audioEngine: false,
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.047, 0.061, 0.071, 1);
  scene.ambientColor = new Color3(0.18, 0.2, 0.21);
  scene.environmentTexture = createArenaEnvironment(scene);
  scene.environmentIntensity = 0.85;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.2;
  scene.imageProcessingConfiguration.contrast = 1.08;
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new Color3(0.047, 0.061, 0.071);
  const camera = new FreeCamera('arena-camera', new Vector3(7.4, 5.8, 8.5), scene);
  camera.minZ = 0.12;
  camera.maxZ = 200;
  camera.fov = 0.76;
  camera.setTarget(new Vector3(0, 0.4, 0));
  scene.activeCamera = camera;

  const fill = new HemisphericLight('ambient-fill', new Vector3(0.2, 1, -0.25), scene);
  fill.intensity = 0.9;
  fill.diffuse = new Color3(0.79, 0.86, 0.9);
  fill.groundColor = new Color3(0.15, 0.17, 0.2);
  const key = new DirectionalLight('arena-key', new Vector3(-0.45, -1, -0.28), scene);
  key.position.set(8, 18, 7);
  key.intensity = 2.3;
  key.diffuse = new Color3(1, 0.91, 0.73);
  key.shadowMinZ = 0.1;
  key.shadowMaxZ = 60;
  const rim = new PointLight('cold-rim', new Vector3(-5, 6, -4), scene);
  rim.diffuse = Color3.FromHexString('#92b8d6');
  rim.intensity = 1.8;
  rim.range = 22;
  const shadows = new ShadowGenerator(1024, key);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.0015;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.35;
  const stage = makeStage(scene);
  const sound = new ArenaSound();
  const bots = new Map<string, DisplayBot>();
  const lifeBars = createLifeBars(scene, camera);
  const debris = new DebrisRenderer(scene, (id) => bots.get(id)?.model);
  const explosions = createExplosions(scene);
  const previewId = 'preview-selected';
  const rivalId = 'preview-rival';
  let snapshot: MatchState | null = null;
  let localId: string | null = null;
  let input: PlayerInput = { ...NEUTRAL_INPUT };
  let lastUpdateAt = performance.now();
  let time = 0;
  let disposed = false;
  let lastEventId = -1;
  let lastRoomId = '';
  let shake = 0;
  let finishFocus: { position: Vector3; remaining: number } | null = null;
  let previewBot: BotId = 'witchdoctor';
  let previewPaint: PaintId = 'signature';
  let fpsTime = 0;
  let fpsFrames = 0;
  let orbitYaw = 0.72;
  let orbitElevation = 0.48;
  let orbitDistance = 6.8;
  let overview = false;
  let orbitPointer: { id: number; x: number; y: number } | null = null;
  const cameraTarget = new Vector3(0, 0.5, 0);
  const desiredCamera = new Vector3();
  const targetPosition = new Vector3();
  const targetQuaternion = Quaternion.Identity();
  const headingCorrection = Quaternion.Identity();
  const authoritativeQuaternion = Quaternion.Identity();
  const previewQuaternion = Quaternion.Identity();
  const lifePosition = Vector3.Zero();
  const transformedCorner = Vector3.Zero();
  const identity = Matrix.Identity();

  const sparkMaterial = material(scene, 'impact-spark', '#ffcf68');
  sparkMaterial.emissiveColor = new Color3(1, 0.53, 0.1);
  sparkMaterial.disableLighting = true;
  const sparks: Spark[] = [];
  let sparkCursor = 0;
  for (let n = 0; n < 52; n += 1) {
    const mesh = MeshBuilder.CreateBox(`spark-${n}`, { width: 0.035, height: 0.035, depth: 0.2 }, scene);
    mesh.material = sparkMaterial;
    mesh.isVisible = false;
    mesh.isPickable = false;
    sparks.push({ mesh, velocity: Vector3.Zero(), life: 0 });
  }

  function ensureBot(id: string, botId: BotId, paint: PaintId): DisplayBot {
    const existing = bots.get(id);
    if (existing && existing.model.botId === botId && existing.model.paint === paint) return existing;
    if (existing) {
      debris.removeOwner(id);
      for (const mesh of existing.model.meshes) shadows.removeShadowCaster(mesh);
      existing.weaponBlur.dispose(false, true);
      existing.model.dispose();
    }
    const model = makeBot(scene, botId, paint, id);
    model.root.position.set(0, BOTS[botId].physics.wheelRadius, 0);
    model.root.rotationQuaternion = Quaternion.Identity();
    for (const mesh of model.meshes) if (!mesh.name.includes('damage-scar-')) shadows.addShadowCaster(mesh);
    const blurMaterial = material(scene, `${id}-weapon-sweep`, '#a6aaab');
    blurMaterial.emissiveColor = new Color3(0.28, 0.30, 0.31);
    blurMaterial.alpha = 0.10;
    blurMaterial.backFaceCulling = false;
    blurMaterial.disableLighting = true;
    const weapon = BOTS[botId].weapon;
    const weaponBlur = MeshBuilder.CreateDisc(`${id}-rotor-sweep`, { radius: weapon.radius, tessellation: 48, sideOrientation: 2 }, scene);
    weaponBlur.parent = model.weapon;
    if (weapon.kind === 'vertical-disc') weaponBlur.rotation.y = Math.PI / 2;
    else weaponBlur.rotation.x = Math.PI / 2;
    weaponBlur.material = blurMaterial;
    weaponBlur.isPickable = false;
    weaponBlur.visibility = 0;
    const minimum = new Vector3(Infinity, Infinity, Infinity);
    const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of model.meshes) {
      if (!mesh.isVisible || !mesh.isEnabled()) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minimum.minimizeInPlace(box.minimumWorld); maximum.maximizeInPlace(box.maximumWorld);
    }
    const bounds: Vector3[] = [];
    for (const x of [minimum.x, maximum.x]) for (const y of [minimum.y, maximum.y]) for (const z of [minimum.z, maximum.z]) {
      bounds.push(new Vector3(x - model.root.position.x, y - model.root.position.y, z - model.root.position.z));
    }
    const display = { model, state: null, weaponBlur, displayedHealth: 100, damageRevision: -1, cameraYaw: null, bounds };
    bots.set(id, display);
    return display;
  }

  function removeBot(id: string): void {
    const bot = bots.get(id);
    if (!bot) return;
    lifeBars.remove(id);
    debris.removeOwner(id);
    for (const mesh of bot.model.meshes) shadows.removeShadowCaster(mesh);
    bot.weaponBlur.dispose(false, true);
    bot.model.dispose();
    bots.delete(id);
  }

  function preview(): void {
    for (const id of bots.keys()) {
      if (id !== previewId && id !== rivalId) removeBot(id);
    }
    const first = ensureBot(previewId, previewBot, previewPaint);
    first.model.root.position.set(0, BOTS[previewBot].physics.wheelRadius, 0);
    const rival = ensureBot(rivalId, previewBot === 'witchdoctor' ? 'tombstone' : 'witchdoctor', 'signature');
    rival.model.root.position.set(-5.7, BOTS[rival.model.botId].physics.wheelRadius, -6.5);
    rival.model.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.55, 0, 0);
  }

  function burst(position: { x: number; y: number; z: number }, strength: number): void {
    shake = Math.min(0.2, 0.05 + strength * 0.004);
    sound.hit(strength);
    const count = 8 + Math.round(Math.min(1.5, strength) * 12);
    for (let n = 0; n < count; n += 1) {
      const spark = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparks.length;
      if (!spark) continue;
      spark.mesh.position.set(position.x, Math.max(0.3, position.y), position.z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5;
      spark.velocity.set(Math.sin(angle) * speed, 1.5 + Math.random() * 4, Math.cos(angle) * speed);
      spark.life = 0.2 + Math.random() * 0.35;
      spark.mesh.rotation.set(Math.random() * 3, angle, 0);
      spark.mesh.isVisible = true;
    }
  }

  function fitResolution(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.65);
    engine.setHardwareScalingLevel(1 / ratio);
    engine.resize();
  }
  const resize = new ResizeObserver(fitResolution);
  resize.observe(canvas);
  window.addEventListener('resize', fitResolution);
  const unlockAudio = () => sound.unlock();
  const orbitDown = (event: PointerEvent) => {
    if (snapshot) return;
    orbitPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  const orbitMove = (event: PointerEvent) => {
    if (!orbitPointer || orbitPointer.id !== event.pointerId || snapshot) return;
    orbitYaw -= (event.clientX - orbitPointer.x) * 0.008;
    orbitElevation = Math.max(0.12, Math.min(1.12, orbitElevation + (event.clientY - orbitPointer.y) * 0.006));
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;
  };
  const orbitEnd = (event: PointerEvent) => {
    if (orbitPointer?.id !== event.pointerId) return;
    orbitPointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const orbitZoom = (event: WheelEvent) => {
    if (snapshot) return;
    event.preventDefault();
    orbitDistance = Math.max(overview ? 38 : 5.6, Math.min(overview ? 100 : 14, orbitDistance + event.deltaY * (overview ? 0.05 : 0.008)));
  };
  canvas.addEventListener('pointerdown', orbitDown);
  canvas.addEventListener('pointermove', orbitMove);
  canvas.addEventListener('pointerup', orbitEnd);
  canvas.addEventListener('pointercancel', orbitEnd);
  canvas.addEventListener('wheel', orbitZoom, { passive: false });
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  fitResolution();
  preview();
  // Compile the hidden impact overlay while loading, before the first real hit.
  await Promise.all([explosions.ready(), ...[...bots.values()].map(async ({ model }) => {
    const scar = model.meshes.find((mesh) => mesh.name.includes('damage-scar-'));
    if (scar?.material) await scar.material.forceCompilationAsync(scar);
  })]);

  engine.runRenderLoop(() => {
    if (disposed) return;
    const frameSeconds = engine.getDeltaTime() / 1000;
    const dt = Math.min(frameSeconds, 0.05);
    time += dt;
    const blend = 1 - Math.exp(-dt * 14);
    const elapsed = Math.min((performance.now() - lastUpdateAt) / 1000, PHYSICS.maxPredictionSeconds);
    stage.pulse(time);

    if (snapshot) {
      for (const [id, bot] of bots) {
        const player = bot.state;
        if (!player) continue;
        const isLocal = id === localId;
        const advancing = snapshot.phase.kind === 'fighting' || snapshot.phase.kind === 'finished';
        predictMotionToRef(player, elapsed, advancing, targetPosition, authoritativeQuaternion);
        const definition = BOTS[player.botId];
        const rotation = player.rotation;
        const up = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
        let predictedYaw = 0;
        if (snapshot.phase.kind === 'fighting') {
          if (isLocal && player.grounded && Math.abs(up) > 0.7 && !player.recovering) {
            const grip = player.inverted && player.botId === 'witchdoctor' ? 0.35 : 1;
            const driveTuning = damagedDriveTuning(player.botId, player.damage);
            const desiredYawRate = (steeringForDrive(input.throttle, input.steer) * definition.turnSpeed * driveTuning.turnScale + input.throttle * driveTuning.yawPull) * grip;
            const yawChange = Math.max(-definition.physics.angularAcceleration * elapsed,
              Math.min(definition.physics.angularAcceleration * elapsed, desiredYawRate - player.angularVelocity.y));
            predictedYaw = yawChange * 0.5 * elapsed;
            const prediction = driveVelocity(player.yaw + player.angularVelocity.y * elapsed + predictedYaw, input.throttle, definition.speed * grip * driveTuning.speedScale);
            const blendAcceleration = 1 - Math.exp(-definition.physics.acceleration * elapsed / definition.speed);
            targetPosition.x += (prediction.x - player.velocity.x) * blendAcceleration * elapsed * 0.5;
            targetPosition.z += (prediction.z - player.velocity.z) * blendAcceleration * elapsed * 0.5;
          }
        }
        targetPosition.x = Math.max(-ARENA.halfWidth + 0.9, Math.min(ARENA.halfWidth - 0.9, targetPosition.x));
        targetPosition.z = Math.max(-ARENA.halfDepth + 1.1, Math.min(ARENA.halfDepth - 1.1, targetPosition.z));
        const poseBlend = 1 - Math.exp(-dt * (player.grounded ? isLocal ? 26 : 20 : 38));
        Vector3.LerpToRef(bot.model.root.position, targetPosition, poseBlend, bot.model.root.position);
        Quaternion.RotationYawPitchRollToRef(predictedYaw, 0, 0, headingCorrection);
        headingCorrection.multiplyToRef(authoritativeQuaternion, targetQuaternion);
        const current = bot.model.root.rotationQuaternion;
        if (current) Quaternion.SlerpToRef(current, targetQuaternion, poseBlend, current);
        for (const wheel of bot.model.wheels) {
          wheel.rotation.x += (wheel.position.x < 0 ? player.wheelSpeedLeft : player.wheelSpeedRight) * dt;
        }
        const weaponAngle = player.weaponAngle + definition.weapon.spinDirection * player.weaponRpm * Math.PI / 30 * elapsed;
        if (definition.weapon.kind === 'vertical-disc') bot.model.weapon.rotation.x = weaponAngle;
        else bot.model.weapon.rotation.y = weaponAngle;
        bot.weaponBlur.visibility = Math.max(0, Math.min(1, (player.weaponRpm / definition.weapon.maxRpm - 0.15) * 1.15));
        if (bot.model.selfRighter) bot.model.selfRighter.rotation.x = -Math.sin(player.recoveryProgress * Math.PI) * 2.6;
        bot.model.pulseDamage(time, dt);
        const world = bot.model.root.computeWorldMatrix(true);
        let top = -Infinity;
        for (const corner of bot.bounds) {
          Vector3.TransformCoordinatesToRef(corner, world, transformedCorner);
          top = Math.max(top, transformedCorner.y);
        }
        lifePosition.set(bot.model.root.position.x, top + 0.55, bot.model.root.position.z);
        lifeBars.setPosition(id, lifePosition);
        bot.model.root.setEnabled(true);
        bot.model.glow.alpha = player.connected ? 1 : 0.25;
        if (isLocal) sound.motor(player.weaponRpm / definition.weapon.maxRpm, Math.hypot(player.velocity.x, player.velocity.z) / definition.speed, player.botId === 'tombstone');
      }

      const followed = localId ? bots.get(localId) : bots.values().next().value;
      if (finishFocus && finishFocus.remaining > 0) {
        const position = finishFocus.position;
        const yaw = followed?.cameraYaw ?? 0;
        desiredCamera.set(
          Math.max(-ARENA.halfWidth + 0.4, Math.min(ARENA.halfWidth - 0.4, position.x - Math.sin(yaw) * 10)),
          Math.max(7, position.y + 6.5),
          Math.max(-ARENA.halfDepth + 0.4, Math.min(ARENA.halfDepth - 0.4, position.z - Math.cos(yaw) * 10)),
        );
        Vector3.LerpToRef(camera.position, desiredCamera, 1 - Math.exp(-dt * 12), camera.position);
        targetPosition.set(position.x, position.y + 0.7, position.z);
        Vector3.LerpToRef(cameraTarget, targetPosition, 1 - Math.exp(-dt * 20), cameraTarget);
        camera.setTarget(cameraTarget);
        finishFocus.remaining -= dt;
        canvas.dataset.opponentDirection = 'visible';
      } else if (followed) {
        const position = followed.model.root.position;
        const player = followed.state;
        followed.cameraYaw = player ? followHeading(followed.cameraYaw ?? player.yaw, player.yaw, player.grounded, dt) : 0;
        const yaw = followed.cameraYaw;
        const behindX = -Math.sin(yaw) * 7.6;
        const behindZ = -Math.cos(yaw) * 7.6;
        desiredCamera.set(
          Math.max(-ARENA.halfWidth + 0.4, Math.min(ARENA.halfWidth - 0.4, position.x + behindX)),
          Math.max(5.4, position.y + 5.3 + (!player?.grounded ? Math.max(0, player?.velocity.y ?? 0) * .08 : 0)),
          Math.max(-ARENA.halfDepth + 0.4, Math.min(ARENA.halfDepth - 0.4, position.z + behindZ)),
        );
        Vector3.LerpToRef(camera.position, desiredCamera, 1 - Math.exp(-dt * (player?.grounded ? 7 : 12)), camera.position);
        targetPosition.set(position.x + Math.sin(yaw) * 1.7, position.y + 0.2, position.z + Math.cos(yaw) * 1.7);
        Vector3.LerpToRef(cameraTarget, targetPosition, 1 - Math.exp(-dt * 13), cameraTarget);
        camera.setTarget(cameraTarget);
        const opponent = snapshot.players.find((item) => item.id !== localId);
        if (opponent) {
          const viewport = new Viewport(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
          const projected = Vector3.Project(new Vector3(opponent.position.x, opponent.position.y, opponent.position.z), identity, scene.getTransformMatrix(), viewport);
          const inFrame = projected.z > 0 && projected.z < 1 && projected.x > 25 && projected.x < engine.getRenderWidth() - 25 && projected.y > 25 && projected.y < engine.getRenderHeight() - 25;
          const angle = Math.atan2(opponent.position.x - position.x, opponent.position.z - position.z) - yaw;
          canvas.dataset.opponentDirection = inFrame ? 'visible' : angle > 0 && angle < Math.PI || angle < -Math.PI ? 'right' : 'left';
        }
      }
    } else {
      const selected = bots.get(previewId);
      if (selected) {
        Quaternion.RotationYawPitchRollToRef(-0.23, 0, 0, previewQuaternion);
        const current = selected.model.root.rotationQuaternion;
        if (current) Quaternion.SlerpToRef(current, previewQuaternion, blend, current);
        selected.weaponBlur.visibility = 0;
      }
      const horizontalDistance = Math.cos(orbitElevation) * orbitDistance;
      desiredCamera.set(Math.sin(orbitYaw) * horizontalDistance, Math.sin(orbitElevation) * orbitDistance + 0.5, Math.cos(orbitYaw) * horizontalDistance);
      Vector3.LerpToRef(camera.position, desiredCamera, 1 - Math.exp(-dt * 2.5), camera.position);
      Vector3.LerpToRef(cameraTarget, new Vector3(0, 0.4, 0.15), blend, cameraTarget);
      camera.setTarget(cameraTarget);
      canvas.dataset.opponentDirection = 'visible';
      sound.motor(0, 0, false);
    }

    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.velocity.y -= dt * 12;
      spark.mesh.position.addInPlace(spark.velocity.scale(dt));
      spark.mesh.scaling.setAll(Math.min(1, spark.life * 5));
      if (spark.life <= 0) spark.mesh.isVisible = false;
    }
    if (shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake *= Math.exp(-dt * 12);
    }

    debris.pulse(dt, elapsed);
    explosions.pulse(dt);
    lifeBars.pulse(dt);
    scene.render();
    fpsTime += frameSeconds;
    fpsFrames += 1;
    if (fpsTime > 1) {
      canvas.dataset.fps = String(Math.round(fpsFrames / fpsTime));
      fpsTime = 0;
      fpsFrames = 0;
    }
  });

  return {
    update(next, playerId) {
      if (disposed) return;
      const combatFinished = snapshot?.roomId === next.roomId && snapshot.phase.kind !== 'finished' && next.phase.kind === 'finished';
      if (lastRoomId !== next.roomId || next.tick < (snapshot?.tick ?? 0)) { lastEventId = -1; debris.clear(); explosions.clear(); finishFocus = null; }
      if (next.phase.kind === 'lobby' || next.phase.kind === 'countdown') { explosions.clear(); finishFocus = null; }
      lastRoomId = next.roomId;
      snapshot = next;
      scene.fogDensity = 0.012;
      stage.setState(next.arena);
      localId = playerId;
      lastUpdateAt = performance.now();
      const ids = new Set(next.players.map((item) => item.id));
      for (const id of bots.keys()) if (!ids.has(id)) removeBot(id);
      for (const player of next.players) {
        const isNew = !bots.has(player.id);
        const display = ensureBot(player.id, player.botId, player.paint);
        display.state = player;
        lifeBars.setHealth(player.id, player.health);
        if (display.damageRevision !== player.damage.revision || display.displayedHealth !== player.health) {
          display.model.setDamage(player.damage, 1 - player.health / 100);
          display.damageRevision = player.damage.revision;
          display.displayedHealth = player.health;
        }
        if (isNew || next.phase.kind === 'lobby' || next.phase.kind === 'countdown') {
          display.cameraYaw = player.yaw;
          display.model.root.position.set(player.position.x, player.position.y, player.position.z);
          const q = player.rotation;
          display.model.root.rotationQuaternion?.set(q.x, q.y, q.z, q.w);
        }
      }
      debris.update(next.debris);
      for (const event of next.events) {
        if (event.id <= lastEventId) continue;
        lastEventId = event.id;
        if (event.kind === 'hit' || event.kind === 'hazard') burst(event.position, event.strength);
        if (event.kind === 'break') burst(event.position, Math.max(1, event.strength * 1.5));
        if (event.kind === 'landing') {
          if (event.sourceId === playerId) shake = Math.max(shake, Math.min(0.18, event.strength * 0.14));
          sound.hit(event.strength * 0.5);
        }
        if (event.kind === 'explosion' && combatFinished) {
          explosions.trigger(event.position, event.id);
          if (finishFocus) finishFocus.position.addInPlaceFromFloats(event.position.x, event.position.y, event.position.z).scaleInPlace(0.5);
          else finishFocus = { position: new Vector3(event.position.x, event.position.y, event.position.z), remaining: DEFEAT_REVEAL_SECONDS };
          shake = Math.max(shake, 0.32);
          sound.explosion();
        }
      }
    },
    setInput(next) { input = next; },
    setPreview(botId, paint) {
      if (disposed) return;
      snapshot = null;
      lifeBars.clear();
      debris.clear();
      explosions.clear();
      finishFocus = null;
      stage.setState(null);
      scene.fogDensity = overview ? 0.003 : 0.012;
      localId = null;
      input = { ...NEUTRAL_INPUT };
      previewBot = botId;
      previewPaint = paint;
      lastEventId = -1;
      preview();
    },
    setOverview(enabled) {
      overview = enabled;
      orbitDistance = enabled ? 82 : 6.8;
      orbitElevation = enabled ? 0.86 : 0.48;
      orbitYaw = enabled ? 0.28 : 0.72;
      scene.fogDensity = enabled ? 0.003 : 0.012;
    },
    setMuted(muted) { sound.setMuted(muted); },
    dispose() {
      if (disposed) return;
      disposed = true;
      resize.disconnect();
      window.removeEventListener('resize', fitResolution);
      canvas.removeEventListener('pointerdown', orbitDown);
      canvas.removeEventListener('pointermove', orbitMove);
      canvas.removeEventListener('pointerup', orbitEnd);
      canvas.removeEventListener('pointercancel', orbitEnd);
      canvas.removeEventListener('wheel', orbitZoom);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      engine.stopRenderLoop();
      sound.dispose();
      debris.clear();
      lifeBars.dispose();
      explosions.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
