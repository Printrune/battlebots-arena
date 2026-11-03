# BattleBox hazards

The server owns the fight clock, hazard phases, damage and impulses. Every snapshot includes `arena.elapsed` and a discriminated list of screw, pulverizer and killsaw states. The renderer animates the same shared layout and hammer-angle functions; it never decides hits from a browser timer.

The alternative of independent browser timers was rejected because reconnects, delayed packets and different frame rates would produce different hazard contacts. Sending full moving mesh transforms was also unnecessary; phase and progress describe the small set of mechanisms directly.

`src/shared/arena.ts` owns layout, timing constants, state schemas and hammer geometry. `src/server/arena-hazards.ts` owns physical contacts and mechanism cycles. `src/client/game/stage.ts` owns the enclosure and hazard appearance. Simulation owns damage accounting and rematch reset. The room accepts a separate pulverizer command so ordinary drive packets remain compatible with existing controllers.

Fights last 180 seconds. Killsaws unlock after 120 seconds of fighting, warn before rising and retract between activations. Screws rotate and reverse on jams. Players operate their assigned corner hammers; practice AI may operate its own pair. A rematch resets every hazard, including clock, cooldowns and saw locks. Lobby, countdown and finished states cannot apply hazard damage.

The 48 × 48 ft enclosure follows the 2022 tournament rules. Detailed placement, mechanism rates, damage and impulses are game approximations, documented separately from verified arena facts in `arena-references.md`. Geometry is merged by material and moving mechanisms have bounded mesh counts to protect mobile performance.
