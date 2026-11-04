# Impact and flight physics

Rapier remains the authoritative rigid-body engine. The arena uses feet, kilograms and seconds consistently, including gravity at 32.174 ft/s². Weapon rotor inertia and mass are explicit game approximations. Their stored rotational energy, contact-point motion, target effective mass and contact offset determine an impulse and energy transfer. Recoil is reciprocal; an off-center contact creates angular motion through the rigid body rather than an imposed upright pose.

The alternative of adding a second browser physics engine was rejected because two solvers would disagree about damage, launches and landings. A shared unit convention and an isolated server impact solver improve the existing authoritative simulation without adding another network writer.

The server publishes grounded state and full linear/angular velocity. The client uses bounded ballistic prediction while airborne and preserves roll and pitch. Air controls cannot accelerate a robot in empty space. The chase camera keeps a stable heading through a tumble, and health bars follow the rendered body.

Hard landing damage uses a real support contact and downward impact speed with a threshold and cooldown. Resting, ordinary traction and small floor bumps cannot repeatedly damage a bot. The established component damage, breakable wheels, recovery, hazards and rematch reset remain part of the same Rapier world.

These are tuned combat-game forces and failure thresholds, not calibrated team telemetry or a deformable-body engineering simulation. Verification exercises mass response, contact offsets, rotor energy, reciprocal recoil, real trajectories, landings and the existing multiplayer lifecycle.

The implementation follows Rapier's primary documentation for [forces and impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/) and [rigid-body mass, inertia, damping and continuous collision detection](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/). Rotor masses and inertias are reconstruction choices; they are not asserted as measured specifications of either team.
