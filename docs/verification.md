# Release verification

The local v0.6 production build was verified with the checks below. Measurements describe this computer and local connections. Load and detailed damage-transport measurements below are retained from v0.5.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript and production client/server builds | Passed |
| Simulation, impacts, flight, damage, hazards, render prediction, steering and authentication | 58 tests passed |
| Reverse steering | Real Rapier fixtures verify forward/reverse left and right travel arcs and stationary pivots for both bots; both fixtures failed before the fix |
| Defeat explosion | Real simulation fixtures verify a single explosion, physical debris, unaffected winner, mutual knockout, time decision and rematch restoration |
| Explosion renderer | Two pooled effects, 46 meshes, five materials, 4,084 triangles and no textures; flash, motion, expiry, capacity, reuse and disposal passed |
| Robot models | Eight robot/paint variants passed geometry, wheel, ground-alignment and disposal checks |
| Visible component damage | Both bots passed missing-wheel/armor, deformation, debris-cloning, pristine restoration and cleanup checks |
| Overhead life bars | Two pooled bars/eight planes passed HP labels, damage trail, distance scaling, knockout, rematch reuse and disposal checks |
| Damage transport | Tombstone lost its left wheel with 31.85 hull life remaining; both clients saw debris, reconnect preserved damage, and rematch repaired it |
| Arena model | 48 × 48 floor, half-foot Upper Deck, moving mechanisms and disposal checks passed |
| Hazard contacts | In-air misses, hammer ownership/cooldown, one hit per hammer strike, screw lifting/reversal and physical Upper Deck ascent passed |
| Lifecycle | Lobby/countdown/finished clock freeze and full rematch reset passed |
| Access controls | Unauthenticated matchmaking and WebSockets, and incorrect passwords, rejected |
| Two-client combat | Countdown, shared knockout/explosion result, reconnect to the same seat, rematch and forfeit passed; both clients received one explosion and seven rigid debris parts |
| Real-time arena transport | 1,813 identical hazard snapshots; killsaws stayed locked until 120 seconds and the first physical saw hit reduced life to 96.5 at 120.77 seconds |
| Four rooms / eight clients | 29.972 authoritative updates per second per room over 20 seconds |
| Room capacity | Fifth room rejected with 503 |

The impact fixtures use actual Rapier bodies and contact geometry. They verify mass and off-center inertia response, reciprocal recoil, bounded rotor energy loss, and sequential mutual-hit resolution. A controlled full-speed Witch Doctor contact lifted Tombstone's center of mass approximately 2.14 feet without an imposed upward impulse. A normal v0.6 multiplayer fight observed 55 airborne player snapshots, four hard-landing events and a maximum axle height approximately 4.83 feet above its starting level.

Airborne fixtures verify gravity, angular motion and the absence of drive, braking or self-righting reaction forces without support. Actual floor contacts cause hard-landing damage once; resting contact and small bumps do not repeatedly damage a robot. Finished matches preserve an airborne wreck's trajectory while results, hazard time and damage stay frozen.

The load test measured 0.945 ms average simulation work per update, a 183 ms maximum snapshot gap, and 103.4 MiB process RSS. It uses neutral driving with active spinners and does not represent maximum debris activity. Other local verification processes were running during this sample. The free Render blueprint remains limited to two rooms; cloud capacity must be measured separately.

## Browser checks

The rebuilt BattleBox rendered in Chromium without console errors. The arena uses 68 meshes and 32,622 triangles, including 20 hazard mechanisms. Witch Doctor uses 22,488 triangles and 52 meshes; Tombstone uses 11,516 triangles and 36 meshes. Static geometry is merged within mechanical assemblies, preserving individual wheel and armor motion.

Live v0.6 practice showed the defeated Witch Doctor exploding with a bright fireball, sparks and flying detached parts while Tombstone retained 100 hull life. The camera framed the blast, a short finish callout appeared, and the result panel followed after 2.1 seconds. Multiple live rematches restored the robot. Explosion materials compile during loading; reconnecting directly to an old result does not replay the blast. Sound was enabled during this check and produced no browser errors.

Live practice showed current/100 hull life, thick color-coded bars and recent-damage strips in the HUD, plus upright HP labels above the moving bots. Hull values decreased during real combat and reached zero at knockout. Overhead bars follow the rotated body bounds through tipping and flight. They reuse two texture atlases; HP text updates only when the displayed integer changes.

A 390 × 844 portrait viewport had no horizontal overflow. Its 18-pixel life bars, wheel indicators, hazard status and utility controls did not overlap. Live portrait combat reported 60 fps at one observed sample. The 844 × 390 landscape viewport also fit the life bars, component indicators, hazard status, joystick, weapon, recovery and pulverizer controls without horizontal overflow; one combat sample reported 51 fps. These samples are observations, not a sustained device benchmark.

Practice, weapon activation, driving into a spinning opponent, knockout, rematch and leaving the arena were exercised through the interface. The chase camera keeps its heading during a tumble and resumes following grounded turns. Full roll/pitch and bounded ballistic prediction preserve flights between authoritative snapshots.

Scars are bounded at twelve per robot and detached rigid bodies at sixteen per room, with a sixteen-second lifetime. Damage shaders are compiled during loading; debris remains opaque until cleanup. Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

Physical iPhone Safari and Android Chrome performance, touch feel, thermal behaviour, cloud-host capacity and real remote connections remain unverified. Rotor inertia, damage thresholds and hazard forces are game reconstruction choices, not measured team telemetry. See [impact design](impact-design.md) and [arena references](arena-references.md).

Run `pnpm verify:multiplayer`, `pnpm verify:damage-network`, `pnpm verify:arena-network` and `pnpm verify:load` against a deployed URL to repeat the transport and capacity checks. The arena network check takes about two and a half minutes and uses the actual production clock.
