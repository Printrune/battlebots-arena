/** Feet, kilograms, seconds. Rapier's impulse unit is kg*ft/s; energy converts to joules here. */
export interface ImpactVector { x: number; y: number; z: number }
export interface InverseInertia { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }
export interface ImpactBody {
  center: ImpactVector; velocity: ImpactVector; inverseMass: number; inverseInertia: InverseInertia;
}
export interface RotorImpact {
  mount: ImpactVector; axis: ImpactVector; radius: number;
  angularSpeed: number; inertiaKgFt2: number; maximumEnergyLoss: number;
}
export interface ImpactSolution {
  impulse: ImpactVector; recoil: ImpactVector; magnitude: number;
  energyConsumed: number; dissipatedJoules: number; damage: number;
}

export const IMPACT_TUNING = {
  joulesPerKgFtSquaredPerSecondSquared: 0.09290304,
  restitution: 0.12,
  toothNormalCoupling: 0.45,
  damagePerRootJoule: 0.26,
  maximumWeaponDamage: 38,
  minimumLandingSpeed: 9,
  landingDamagePerRootJoule: 0.18,
  maximumLandingDamage: 16,
  landingCooldown: 0.65,
};

function add(a: ImpactVector, b: ImpactVector): ImpactVector { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: ImpactVector, b: ImpactVector): ImpactVector { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(v: ImpactVector, amount: number): ImpactVector { return { x: v.x * amount, y: v.y * amount, z: v.z * amount }; }
function dot(a: ImpactVector, b: ImpactVector): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: ImpactVector, b: ImpactVector): ImpactVector {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(vector: ImpactVector): number { return Math.hypot(vector.x, vector.y, vector.z); }
function unit(vector: ImpactVector, fallback: ImpactVector = { x: 0, y: 0, z: 1 }): ImpactVector {
  const size = length(vector); return size > 0.000001 ? scale(vector, 1 / size) : { ...fallback };
}
function inertiaProduct(inertia: InverseInertia, value: ImpactVector): ImpactVector {
  return { x: inertia.xx * value.x + inertia.xy * value.y + inertia.xz * value.z,
    y: inertia.xy * value.x + inertia.yy * value.y + inertia.yz * value.z,
    z: inertia.xz * value.x + inertia.yz * value.y + inertia.zz * value.z };
}
function inverseContactMass(body: ImpactBody, point: ImpactVector, direction: ImpactVector): number {
  const moment = cross(subtract(point, body.center), direction);
  return body.inverseMass + Math.max(0, dot(moment, inertiaProduct(body.inverseInertia, moment)));
}

export function rotorEnergy(inertiaKgFt2: number, angularSpeed: number): number {
  return 0.5 * inertiaKgFt2 * angularSpeed * angularSpeed;
}

/** A tooth's swept surface velocity supplies the bite; the real contact normal supplies separation. */
export function solveWeaponImpact(input: {
  attacker: ImpactBody; target: ImpactBody; point: ImpactVector; normal: ImpactVector; rotor: RotorImpact;
}): ImpactSolution {
  const normal = unit(input.normal);
  const angularSpeed = Math.abs(input.rotor.angularSpeed);
  const axis = scale(unit(input.rotor.axis, { x: 1, y: 0, z: 0 }), input.rotor.angularSpeed < 0 ? -1 : 1);
  const offset = subtract(input.point, input.rotor.mount);
  let radial = subtract(offset, scale(axis, dot(offset, axis)));
  const radialLength = length(radial);
  if (radialLength > input.rotor.radius) radial = scale(radial, input.rotor.radius / radialLength);
  const surfaceVelocity = scale(cross(axis, radial), angularSpeed);
  const surfaceSpeed = length(surfaceVelocity);
  const direction = surfaceSpeed > 0.5
    ? unit(add(surfaceVelocity, scale(normal, surfaceSpeed * IMPACT_TUNING.toothNormalCoupling)), normal)
    : normal;
  const bodyRelativeVelocity = subtract(input.attacker.velocity, input.target.velocity);
  const closing = Math.max(0, dot(add(bodyRelativeVelocity, surfaceVelocity), direction));
  const bodyInverseMass = inverseContactMass(input.attacker, input.point, direction) + inverseContactMass(input.target, input.point, direction);
  const lever = Math.abs(dot(cross(radial, direction), axis));
  const rotorInverseMass = input.rotor.inertiaKgFt2 > 0 ? lever * lever / input.rotor.inertiaKgFt2 : 0;
  let magnitude = bodyInverseMass + rotorInverseMass > 0
    ? (1 + IMPACT_TUNING.restitution) * closing / (bodyInverseMass + rotorInverseMass) : 0;
  const stored = rotorEnergy(input.rotor.inertiaKgFt2, angularSpeed);
  if (stored > 0 && lever > 0.000001) {
    const minimumSpeed = angularSpeed * Math.sqrt(Math.max(0, 1 - input.rotor.maximumEnergyLoss));
    const energyLimitedImpulse = input.rotor.inertiaKgFt2 * (angularSpeed - minimumSpeed) / lever;
    magnitude = Math.min(magnitude, energyLimitedImpulse);
  }
  // The impulse can draw only the actual stored rotor energy and incoming ram
  // kinetic energy. Both chassis receive reciprocal impulses at the same point.
  const nextSpeed = Math.max(0, angularSpeed - magnitude * lever / Math.max(0.000001, input.rotor.inertiaKgFt2));
  const energyConsumed = Math.max(0, stored - rotorEnergy(input.rotor.inertiaKgFt2, nextSpeed));
  const bodyEnergyChange = 0.5 * bodyInverseMass * magnitude * magnitude - magnitude * dot(bodyRelativeVelocity, direction);
  const dissipated = Math.max(0, energyConsumed - bodyEnergyChange);
  const dissipatedJoules = dissipated * IMPACT_TUNING.joulesPerKgFtSquaredPerSecondSquared;
  const impulse = scale(direction, magnitude);
  return { impulse, recoil: scale(impulse, -1), magnitude, energyConsumed, dissipatedJoules,
    damage: Math.min(IMPACT_TUNING.maximumWeaponDamage, Math.sqrt(dissipatedJoules) * IMPACT_TUNING.damagePerRootJoule) };
}

/** Called only after a real Rapier contact, with pre-solver normal approach speed. */
export function hardLandingDamage(input: { normalSpeed: number; normalImpulse: number; mass: number }): number {
  if (input.normalSpeed < IMPACT_TUNING.minimumLandingSpeed || input.normalImpulse < input.mass * 1.5) return 0;
  const excess = 0.5 * input.mass * (input.normalSpeed ** 2 - IMPACT_TUNING.minimumLandingSpeed ** 2);
  const joules = Math.max(0, excess) * IMPACT_TUNING.joulesPerKgFtSquaredPerSecondSquared;
  return Math.min(IMPACT_TUNING.maximumLandingDamage, Math.sqrt(joules) * IMPACT_TUNING.landingDamagePerRootJoule);
}
