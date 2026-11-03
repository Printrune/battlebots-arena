import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA, BOTS, COUNTDOWN_SECONDS, INPUT_TIMEOUT_MS, MATCH_SECONDS, NEUTRAL_INPUT,
  driveVelocity,
} from '../shared/protocol';
import type {
  CosmeticSelection, MatchEvent, MatchPhase, MatchResult, MatchState, PlayerInput,
} from '../shared/protocol';

type Body = InstanceType<typeof RAPIER.RigidBody>;

interface Participant {
  id: string;
  spawnSlot: 0 | 1;
  name: string;
  selection: CosmeticSelection;
  body: Body;
  yaw: number;
  health: number;
  ready: boolean;
  connected: boolean;
  input: PlayerInput;
  inputAt: number;
  lastInputSeq: number;
  weaponCharge: number;
  weaponCooldown: number;
  recoveryCooldown: number;
  recoverHeld: boolean;
  hitStun: number;
  damageDealt: number;
  hits: number;
}

interface PendingHit {
  attacker: Participant;
  target: Participant;
  damage: number;
  direction: { x: number; z: number };
}

let initialization: Promise<void> | undefined;

function initializePhysics(): Promise<void> {
  initialization ??= RAPIER.init();
  return initialization;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function uprightRotation(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function upAlignment(body: Body): number {
  const rotation = body.rotation();
  return 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
}

function bodyYaw(body: Body): number {
  const q = body.rotation();
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export class Simulation {
  private readonly world = new RAPIER.World({ x: 0, y: -19, z: 0 });
  private readonly players = new Map<string, Participant>();
  private phase: MatchPhase = { kind: 'lobby' };
  private tick = 0;
  private eventId = 0;
  private events: MatchEvent[] = [];
  private disposed = false;

  constructor(private readonly roomId: string) {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.35, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA.halfWidth + 1, 0.35, ARENA.halfDepth + 1).setFriction(0.65),
      ground,
    );
    const walls = [
      { x: -ARENA.halfWidth - 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1 },
      { x: ARENA.halfWidth + 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1 },
      { x: 0, z: -ARENA.halfDepth - 0.3, hx: ARENA.halfWidth + 1, hz: 0.3 },
      { x: 0, z: ARENA.halfDepth + 0.3, hx: ARENA.halfWidth + 1, hz: 0.3 },
    ];
    for (const wall of walls) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, 2, wall.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(wall.hx, 2, wall.hz).setRestitution(0.15), body);
    }
  }

  addPlayer(id: string, name: string, selection: CosmeticSelection): void {
    if (this.players.has(id)) return;
    if (this.players.size >= 2) throw new Error('The arena already has two players.');
    const slot = [...this.players.values()].some((player) => player.spawnSlot === 0) ? 1 : 0;
    const yaw = slot === 0 ? 0 : Math.PI;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0.55, slot === 0 ? -7 : 7)
        .setRotation(uprightRotation(yaw))
        .setLinearDamping(1.1)
        .setAngularDamping(5)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.45, 1.2).setDensity(24).setFriction(0.8).setRestitution(0.1),
      body,
    );
    this.players.set(id, {
      id, spawnSlot: slot, name, selection: { ...selection }, body, yaw, health: 100,
      ready: false, connected: true, input: { ...NEUTRAL_INPUT }, inputAt: -Infinity,
      lastInputSeq: -1, weaponCharge: 0, weaponCooldown: 0, recoveryCooldown: 0,
      recoverHeld: false, hitStun: 0, damageDealt: 0, hits: 0,
    });
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    if (this.phase.kind === 'fighting' || this.phase.kind === 'countdown') this.forfeit(id);
    this.world.removeRigidBody(player.body);
    this.players.delete(id);
  }

  setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = connected;
    if (!connected) {
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.ready = false;
      if (this.phase.kind === 'countdown') this.phase = { kind: 'lobby' };
    }
  }

  setReady(id: string, ready: boolean): void {
    const player = this.players.get(id);
    if (!player || this.phase.kind !== 'lobby') return;
    player.ready = ready && player.connected;
    if (this.players.size === 2 && [...this.players.values()].every((item) => item.ready && item.connected)) {
      this.phase = { kind: 'countdown', seconds: COUNTDOWN_SECONDS };
    }
  }

  setInput(id: string, input: PlayerInput, nowMs: number): void {
    const player = this.players.get(id);
    if (!player || !player.connected || input.seq <= player.lastInputSeq) return;
    player.input = { ...input };
    player.inputAt = nowMs;
    player.lastInputSeq = input.seq;
  }

  step(dt: number, nowMs: number): void {
    if (this.disposed) return;
    this.tick += 1;
    this.world.timestep = dt;
    if (this.phase.kind === 'finished') return;
    if (this.phase.kind === 'countdown') {
      const seconds = this.phase.seconds - dt;
      this.phase = seconds <= 0.00001
        ? { kind: 'fighting', seconds: MATCH_SECONDS }
        : { kind: 'countdown', seconds };
      this.world.step();
      return;
    }
    if (this.phase.kind === 'lobby') {
      this.world.step();
      return;
    }

    for (const player of this.players.values()) this.updateDriving(player, dt, nowMs);
    this.world.step();
    for (const player of this.players.values()) this.containBody(player);

    // Compute every attack before mutating health, so simultaneous lethal hits are a draw.
    const hits = this.findHits();
    for (const hit of hits) this.applyHit(hit);

    const survivors = [...this.players.values()].filter((player) => player.health > 0);
    if (survivors.length < this.players.size) {
      this.finish({ winnerId: survivors.length === 1 ? survivors[0]?.id ?? null : null, reason: survivors.length === 0 ? 'draw' : 'knockout' });
      return;
    }
    const seconds = this.phase.seconds - dt;
    if (seconds <= 0.00001) {
      const ordered = [...this.players.values()].sort((a, b) => b.health - a.health);
      const winner = ordered[0];
      const runnerUp = ordered[1];
      const draw = !winner || !runnerUp || Math.abs(winner.health - runnerUp.health) < 0.001;
      this.finish({ winnerId: draw ? null : winner.id, reason: draw ? 'draw' : 'timeout' });
    } else {
      this.phase = { kind: 'fighting', seconds };
    }
  }

  private updateDriving(player: Participant, dt: number, nowMs: number): void {
    const liveInput = player.connected && nowMs - player.inputAt <= INPUT_TIMEOUT_MS;
    const input = liveInput ? player.input : NEUTRAL_INPUT;
    const definition = BOTS[player.selection.botId];
    player.weaponCooldown = Math.max(0, player.weaponCooldown - dt);
    player.recoveryCooldown = Math.max(0, player.recoveryCooldown - dt);
    player.hitStun = Math.max(0, player.hitStun - dt);
    player.weaponCharge = clamp(player.weaponCharge + (input.weapon ? 1.4 : -2.5) * dt, 0, 1);

    if (input.recover && !player.recoverHeld && player.recoveryCooldown <= 0) {
      const position = player.body.translation();
      player.body.setRotation(uprightRotation(player.yaw), true);
      player.body.setTranslation({ x: position.x, y: Math.max(position.y, 0.8), z: position.z }, true);
      player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      player.body.setLinvel({ x: 0, y: 2.5, z: 0 }, true);
      player.recoveryCooldown = 3;
      this.addEvent({ kind: 'recover', sourceId: player.id, targetId: player.id, position: { ...position }, strength: 0.3 });
    }
    player.recoverHeld = input.recover;

    const position = player.body.translation();
    const velocity = player.body.linvel();
    const upright = upAlignment(player.body) > 0.45;
    const grounded = position.y < 1.25;
    if (upright && grounded && player.hitStun <= 0) {
      player.yaw += input.steer * definition.turnSpeed * dt;
      player.body.setRotation(uprightRotation(player.yaw), true);
      player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const desired = driveVelocity(player.yaw, input.throttle, definition.speed);
      const acceleration = 1 - Math.exp(-13 * dt);
      player.body.setLinvel({
        x: velocity.x + (desired.x - velocity.x) * acceleration,
        y: velocity.y,
        z: velocity.z + (desired.z - velocity.z) * acceleration,
      }, true);
    } else if (upright) {
      player.yaw = bodyYaw(player.body);
    }
  }

  private containBody(player: Participant): void {
    const position = player.body.translation();
    const x = clamp(position.x, -ARENA.halfWidth + 1, ARENA.halfWidth - 1);
    const z = clamp(position.z, -ARENA.halfDepth + 1.3, ARENA.halfDepth - 1.3);
    // Arcade containment prevents the arena walls from ever ejecting a player.
    if (x !== position.x || z !== position.z || position.y < -1 || position.y > 10) {
      player.body.setTranslation({ x, y: clamp(position.y, 0.55, 10), z }, true);
      const velocity = player.body.linvel();
      player.body.setLinvel({
        x: x !== position.x ? 0 : velocity.x,
        y: position.y < -1 || position.y > 10 ? 0 : velocity.y,
        z: z !== position.z ? 0 : velocity.z,
      }, true);
    }
  }

  private findHits(): PendingHit[] {
    const hits: PendingHit[] = [];
    for (const attacker of this.players.values()) {
      if (!attacker.connected || attacker.health <= 0 || attacker.weaponCharge < 0.6 || attacker.weaponCooldown > 0) continue;
      const definition = BOTS[attacker.selection.botId];
      const origin = attacker.body.translation();
      for (const target of this.players.values()) {
        if (target.id === attacker.id || target.health <= 0) continue;
        const position = target.body.translation();
        const dx = position.x - origin.x;
        const dz = position.z - origin.z;
        const distance = Math.hypot(dx, dz);
        if (distance > definition.weaponReach || Math.abs(position.y - origin.y) > 1.8) continue;
        const direction = distance > 0.001 ? { x: dx / distance, z: dz / distance } : { x: Math.sin(attacker.yaw), z: Math.cos(attacker.yaw) };
        const facing = direction.x * Math.sin(attacker.yaw) + direction.z * Math.cos(attacker.yaw);
        if (facing < (attacker.selection.botId === 'witchdoctor' ? 0.35 : 0.05)) continue;
        hits.push({ attacker, target, damage: definition.damage * (0.65 + 0.35 * attacker.weaponCharge), direction });
        attacker.weaponCooldown = definition.weaponCooldown;
        break;
      }
    }
    return hits;
  }

  private applyHit({ attacker, target, damage, direction }: PendingHit): void {
    const delivered = Math.min(damage, target.health);
    target.health = Math.max(0, target.health - damage);
    target.hitStun = 0.22;
    attacker.damageDealt += delivered;
    attacker.hits += 1;
    const mass = target.body.mass();
    const vertical = attacker.selection.botId === 'witchdoctor';
    target.body.applyImpulse({ x: direction.x * mass * 4.4, y: mass * (vertical ? 3.8 : 1.5), z: direction.z * mass * 4.4 }, true);
    target.body.applyTorqueImpulse({ x: (vertical ? direction.z : direction.z * 0.3) * mass * 0.5, y: vertical ? 0 : mass * 0.8, z: -direction.x * mass * 0.5 }, true);
    const position = target.body.translation();
    this.addEvent({ kind: 'hit', sourceId: attacker.id, targetId: target.id, position: { ...position }, strength: damage / 22 });
  }

  private addEvent(event: Omit<MatchEvent, 'id'>): void {
    this.eventId += 1;
    this.events.push({ id: this.eventId, ...event });
    if (this.events.length > 24) this.events = this.events.slice(-24);
  }

  private finish(result: MatchResult): void {
    if (this.phase.kind === 'finished') return;
    this.phase = { kind: 'finished', result };
    for (const player of this.players.values()) {
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.weaponCharge = 0;
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  forfeit(id: string): void {
    if (!this.players.has(id) || this.phase.kind === 'finished') return;
    const opponent = [...this.players.values()].find((player) => player.id !== id && player.connected);
    this.finish({ winnerId: opponent?.id ?? null, reason: opponent ? 'forfeit' : 'abandoned' });
  }

  rematch(): void {
    if (this.phase.kind !== 'finished') return;
    this.phase = { kind: 'lobby' };
    this.events = [];
    for (const player of this.players.values()) {
      player.yaw = player.spawnSlot === 0 ? 0 : Math.PI;
      player.body.setTranslation({ x: 0, y: 0.55, z: player.spawnSlot === 0 ? -7 : 7 }, true);
      player.body.setRotation(uprightRotation(player.yaw), true);
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      player.health = 100;
      player.ready = false;
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.inputAt = -Infinity;
      player.weaponCharge = 0;
      player.weaponCooldown = 0;
      player.recoveryCooldown = 0;
      player.recoverHeld = false;
      player.hitStun = 0;
      player.damageDealt = 0;
      player.hits = 0;
    }
  }

  snapshot(): MatchState {
    return {
      roomId: this.roomId,
      tick: this.tick,
      phase: this.phase.kind === 'finished'
        ? { kind: 'finished', result: { ...this.phase.result } }
        : { ...this.phase },
      players: [...this.players.values()].map((player) => ({
        id: player.id, name: player.name, ...player.selection,
        position: { ...player.body.translation() }, rotation: { ...player.body.rotation() },
        yaw: player.yaw, velocity: { ...player.body.linvel() }, health: player.health,
        weaponCharge: player.weaponCharge, weaponActive: player.weaponCharge >= 0.6,
        connected: player.connected, ready: player.ready, lastInputSeq: player.lastInputSeq,
        damageDealt: player.damageDealt, hits: player.hits,
      })),
      events: this.events.map((event) => ({ ...event, position: { ...event.position } })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.players.clear();
    this.world.free();
  }
}

export async function createSimulation(roomId: string): Promise<Simulation> {
  await initializePhysics();
  return new Simulation(roomId);
}
