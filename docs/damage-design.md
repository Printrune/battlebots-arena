# Component damage

The server owns localized component integrity, wheel detachment, drive penalties, weapon degradation, count-outs and detached rigid bodies. Clients reconstruct persistent dents and scars from the same bounded damage state. A snapshot, rather than a one-shot event, is enough to restore the appearance after reconnecting.

`src/shared/damage.ts` defines component identities, durability, schemas, drive-condition calculation and limits. Each bot has wheels, left/right/top/rear armor and a weapon assembly. Witch Doctor has four wheel components; Tombstone's two are more durable to account for its lower redundancy. A single normal glancing hit cannot randomly remove an intact wheel.

Damage is selected from the actual contacted collider or robot-local impact position. Armor and wheel damage accumulate independently of hull health. Damage below the break threshold creates dents, scuffs and wobble. Detachable components reaching zero become bounded, synchronized Rapier debris. The weapon stays attached when disabled. Witch Doctor's ribcage remains attached so self-righting has a visible mechanism.

Losing one wheel degrades traction and introduces an asymmetric pull. A controllable limp mode preserves steering with one powered side. Losing all powered wheels starts a ten-second immobilization count-out, while the weapon remains available. Ordinary airborne motion, recovery, input inactivity and hit stun do not start this timer.

Rematches restore every component, remove damage marks and debris, re-enable physical wheel colliders and clear count-outs. Debris has a fixed capacity and lifetime; marks are bounded per bot. Geometry changes only when damage revisions change, not each render frame.

The alternatives were cosmetic health tint alone, and a full deformable-body fracture simulation. The former does not affect play or show where a hit landed; the latter adds unpredictable mobile and network cost. Component integrity with rigid debris gives readable breakage and tactical consequences at a bounded cost. Dimensions, durability and failure forces remain game tuning, not measured team telemetry.
