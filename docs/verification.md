# Release verification

The local v0.4 production build was verified on 3 November 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript and production client/server builds | Passed |
| Simulation, component damage, hazards and authentication | 39 tests passed |
| Robot models | Eight robot/paint variants passed geometry, wheel, ground-alignment and disposal checks |
| Visible component damage | Both bots passed missing-wheel/armor, real deformation, debris-cloning, pristine restoration and cleanup checks |
| Damage transport | A real wheel strike detached Tombstone's left wheel before knockout; both clients saw its debris, reconnect preserved damage, and rematch repaired it |
| Arena model | 48 × 48 floor, half-foot Upper Deck, moving mechanisms and disposal checks passed |
| Hazard timing | Saws remain retracted until 120 seconds, warn for 0.65 seconds and require physical raised-blade contact |
| Hazard contacts | In-air misses, hammer ownership/cooldown, one hit per hammer strike, screw lifting/reversal and physical Upper Deck ascent passed |
| Lifecycle | Lobby/countdown/finished clock freeze and full rematch hazard reset passed |
| Access controls | Unauthenticated matchmaking and WebSockets, and incorrect passwords, rejected |
| Two-client combat | Countdown, knockout, identical results, automatic reconnect to the same seat, rematch and forfeit passed |
| Real-time arena transport | 1,818 identical hazard snapshots across two clients; first saw damage after the real two-minute lockout |
| Four rooms / eight clients | 29.995 simulation updates per second per room over 20 seconds |
| Room capacity | Fifth room rejected with 503 |

The real-time arena check parks a robot over a locked saw slot, waits for the production clock, then verifies a raised-blade contact event and health loss. The check observed health reduced from 100 to 96.5 at approximately 121.13 seconds. It does not change the server clock or use a test-only unlock route.

The four-room load test measured 0.706 ms average simulation work per update, a 155 ms maximum snapshot gap, and 55.0 MiB process RSS. It uses neutral driving with active spinners and does not represent maximum debris activity. A regular two-client combat run averaged 1.554 ms across the server's accumulated workload. These measurements came from the local server. The free Render blueprint remains limited to two rooms; cloud capacity must be measured separately.

## Browser checks

The rebuilt BattleBox rendered in Chromium without console errors. The arena uses 68 meshes and 32,622 triangles, including 20 hazard mechanisms. The damage-ready Witch Doctor uses 22,488 triangles and 52 meshes; Tombstone uses 11,516 triangles and 36 meshes. Static geometry is merged within mechanical assemblies, preserving individual wheel and armor motion.

The live browser showed Tombstone's missing left wheel, exposed axle and damaged handling while hull health remained above zero. Wheel condition labels matched the server. A separate isolated page using the same renderer checked severe damage and pristine reset on both robots. Its controlled damage snapshots are visual QA, not additional game modes. Scars are bounded at twelve per robot and detached rigid bodies at sixteen per room, with a sixteen-second lifetime. Scar shaders are compiled during loading; debris remains opaque until cleanup to avoid compiling a new transparent shader during combat.

The controlled visual preview reported 60 fps, and live damaged combat was observed at approximately 49–52 fps on the test computer. The mobile hammer button visibly entered its server-confirmed swinging state. The three-minute clock, saw-unlock countdown, live screw status, wheel-condition chips, weapon controls and recovery control fit the landscape viewport without horizontal overflow. A 390 × 844 viewport also had no horizontal overflow; its hazard and utility bars sit below the wheel indicators.

Garage inspection, return to robot view, practice, rematch, hammer activation and leaving the arena were exercised through the interface. Floor graphics were checked for readable orientation. The renderer uses the server's blade height and shared hammer phase durations; a browser timer cannot unlock a saw. Frame-rate measurement uses uncapped frame time, and bot damage materials update only when health changes.

Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

Physical iPhone Safari and Android Chrome performance, touch feel on physical devices, thermal behaviour, cloud-host capacity and the new hazards over real remote connections remain unverified. Exact hazard positions and forces are reconstruction choices; see [arena references](arena-references.md).

Run `pnpm verify:multiplayer`, `pnpm verify:arena-network` and `pnpm verify:load` against a deployed URL to repeat the transport and capacity checks. The arena network check takes about two and a half minutes.
