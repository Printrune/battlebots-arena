# Release verification

## Current v0.7.5 checks

All 77 automated tests pass, including VR controller input and the chase tracking parent. The read-only HUD proof also passes with one non-pickable mesh, one material and no pointer observers. It checks health, clock and result status, head-pose following, view bounds, near-plane clearance and disposal. Run `pnpm test` and `pnpm verify:vr-hud` to repeat these checks.

Version 0.7.5 follows the player's bot with a third-person chase view. WebXR keeps native head tracking and stereo eye separation. VR has no screen buttons, pointer rays or control tablet. Its thin health and clock strip stays above the center of the view. Controller input handles ready, driving, weapons, recovery, pulverizers, rematch and recenter. The native headset menu exits VR.

The production Pages bundle passed stereo emulation with real projection textures, 219 rendered frames and no graphics errors. A timed controller sequence started combat, drove the robot and moved the chase camera about five feet. A quarter-meter physical head movement shifted the rendered view by 0.82 feet; Y recenter restored the chase center. A second session restarted a finished fight through the right trigger and repeated the driving check. VR hid the browser controls, and normal controls returned after session exit.

The user confirmed working immersive VR on a physical Quest 3 with v0.7.4. The new v0.7.5 chase view and controller-only interface still need a physical comfort and performance test.

## Prior-build results

The measurements below are retained from earlier releases. They describe this computer and local connections, not a current headset benchmark. Load and detailed damage-transport measurements are from v0.5. The explosion presentation check is from v0.6. The fixed-station VR tablet checks describe builds before v0.7.5.

The current Pages build uses `/bb/`. Some earlier measurements used the previous `/battlebots-arena/` path.

### Prior automated checks

| Check | Result |
| --- | --- |
| TypeScript and production client/server builds | Passed |
| Simulation, impacts, flight, damage, hazards, prediction, steering, static practice, VR input and authentication | 69 tests passed in the v0.7.1 check |
| Static practice | The real Rapier simulation completed countdown, combat, explosion and rematch in a browser Worker without login or a game server |
| Worker clock | Timer and input wakes share a bounded accumulator; real tests verify no double-speed simulation and reject malformed worker commands |
| VR input | Drift dead zone, both-hand action edges, single-controller fallback, HUD trigger conflict, pause baseline and non-XR cleanup passed |
| VR tablet | Actual Babylon pointer events passed single/multiple pointer driving, diagonal holds, release outside the panel, pause neutralization, rematch and cleanup; 19 planes and one browser atlas |
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

The impact fixtures use actual Rapier bodies and contact geometry. They verify mass and off-center inertia response, reciprocal recoil, bounded rotor energy loss, and sequential mutual-hit resolution. A controlled full-speed Witch Doctor contact lifted Tombstone's center of mass approximately 2.14 feet without an imposed upward impulse. A normal v0.7 multiplayer fight observed 65 airborne player snapshots, four hard-landing events and a maximum axle height approximately 5.60 feet above its starting level. Both clients agreed on the explosion, winner and rematch.

Airborne fixtures verify gravity, angular motion and the absence of drive, braking or self-righting reaction forces without support. Actual floor contacts cause hard-landing damage once; resting contact and small bumps do not repeatedly damage a robot. Finished matches preserve an airborne wreck's trajectory while results, hazard time and damage stay frozen.

The load test measured 0.945 ms average simulation work per update, a 183 ms maximum snapshot gap, and 103.4 MiB process RSS. It uses neutral driving with active spinners and does not represent maximum debris activity. Other local verification processes were running during this sample. The free Render blueprint remains limited to two rooms; cloud capacity must be measured separately.

### Prior browser checks

#### Fixed-station VR entry regression

An immersive reproduction used Meta's [IWER runtime](https://meta-quest.github.io/immersive-web-emulation-runtime/getting-started.html) with the exact production JavaScript, without importing a separate Babylon instance. A real WebGL framebuffer with color and depth attachments exercised both eye viewports. Its completeness check passed and WebGL reported no error.

The old camera code failed to place the rendered eyes at the driver station. With a synthetic tracking origin eight meters away on both horizontal axes and an initial 180-degree heading, the rendered eye remained near `(26.14, 5.25, -26.25)` feet, outside the BattleBox with an almost empty view. The fixed parent tracking origin placed it near `(-3.90, 5.30, -29.01)`, including stereo eye separation. The arena and control tablet were visible in both eyes. A quarter-meter head movement moved the view naturally, and recenter restored the station.

The same production test withheld viewer poses for four seconds. The session stayed paused, then anchored correctly when the first valid pose arrived at approximately 4,007 ms. Controller A started the match, and pause/resume retained the correct view. A deliberately injected draw failure ended the immersive session and displayed its reason in the browser. These prior-build checks verify the emulated render and lifecycle paths. The user later confirmed working immersive VR on Quest 3 with v0.7.4.

Actual Babylon camera and controller-manager regressions cover the shared parent origin, unchanged native tracking poses, stereo separation, head movement and offline generic-trigger profile binding. The reproduction fixture and screenshots are local development artifacts in `.local`.

#### Desktop and mobile rendering

The static build was served under `/battlebots-arena/` to exercise the same base path as GitHub Pages. Browser practice ran without a session API or WebSocket server. Live combat showed damage, airborne motion and the new VR setup control; one 844 × 390 sample reported 59 fps with no horizontal overflow. Starting practice, knockout, rematch and leaving were exercised through the interface. No browser errors were recorded.

An isolated desktop preview rendered the same 3D VR tablet and BattleBox. Its atlas was upright and readable, and selecting the actual 3D weapon button changed the displayed state to weapon-on and 4,500 RPM. The preview exposed a center cage post blocking the initial station; both stations were moved four feet to the side and face the arena center. The fixed right-side tablet leaves the central view open. This checks canvas layout and mesh picking, not stereo rendering, headset comfort or physical controller support.

Explosion, damage and VR materials compile during loading. The hidden VR tablet draws its atlas before returning from construction; its readiness proof checks initialization before any match arrives. This fixes a browser startup deadlock found during the public-link test, where shader compilation waited for a texture that was only drawn after loading. Headset rendering skips desktop camera follow and shake, and life bars use the active XR camera. The XR frame drives input sampling and publishes after held tablet controls have been combined with controller input. The send clock preserves its remainder at common headset refresh rates. Headset focus loss, source removal and native select-end release held driving input.

The rebuilt BattleBox rendered in Chromium without console errors. The arena uses 68 meshes and 32,622 triangles, including 20 hazard mechanisms. Witch Doctor uses 22,488 triangles and 52 meshes; Tombstone uses 11,516 triangles and 36 meshes. Static geometry is merged within mechanical assemblies, preserving individual wheel and armor motion.

Live v0.6 practice showed the defeated Witch Doctor exploding with a bright fireball, sparks and flying detached parts while Tombstone retained 100 hull life. The camera framed the blast, a short finish callout appeared, and the result panel followed after 2.1 seconds. Multiple live rematches restored the robot. Explosion materials compile during loading; reconnecting directly to an old result does not replay the blast. Sound was enabled during this check and produced no browser errors.

Live practice showed current/100 hull life, thick color-coded bars and recent-damage strips in the HUD, plus upright HP labels above the moving bots. Hull values decreased during real combat and reached zero at knockout. Overhead bars follow the rotated body bounds through tipping and flight. They reuse two texture atlases; HP text updates only when the displayed integer changes.

A 390 × 844 portrait viewport had no horizontal overflow. Its 18-pixel life bars, wheel indicators, hazard status and utility controls did not overlap. Live portrait combat reported 60 fps at one observed sample. The 844 × 390 landscape viewport also fit the life bars, component indicators, hazard status, joystick, weapon, recovery and pulverizer controls without horizontal overflow; one combat sample reported 51 fps. These samples are observations, not a sustained device benchmark.

Practice, weapon activation, driving into a spinning opponent, knockout, rematch and leaving the arena were exercised through the interface. The chase camera keeps its heading during a tumble and resumes following grounded turns. Full roll/pitch and bounded ballistic prediction preserve flights between authoritative snapshots.

Scars are bounded at twelve per robot and detached rigid bodies at sixteen per room, with a sixteen-second lifetime. Damage shaders are compiled during loading; debris remains opaque until cleanup. Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

The v0.7.5 chase view, controller mappings, native exit, tracking, comfort and sustained frame rate need a physical Quest 3 retest. The user's v0.7.4 test confirmed working immersive VR, without detailed measurements. Other headsets remain unverified and require usable gamepad input in a compatible WebXR browser. See [VR support](vr-support.md). Physical iPhone Safari and Android Chrome performance, touch feel, thermal behaviour, cloud-host capacity and real remote multiplayer remain unverified. Rotor inertia, damage thresholds and hazard forces are game reconstruction choices, not measured team telemetry. See [impact design](impact-design.md) and [arena references](arena-references.md).

Run `pnpm verify:multiplayer`, `pnpm verify:damage-network`, `pnpm verify:arena-network` and `pnpm verify:load` against a deployed URL to repeat the transport and capacity checks. The arena network check takes about two and a half minutes and uses the actual production clock.
