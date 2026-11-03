# Release verification

The local v0.3 production build was verified on 3 November 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript and production client/server builds | Passed |
| Simulation, hazards and authentication | 29 tests passed |
| Robot models | Eight robot/paint variants passed geometry, wheel, ground-alignment and disposal checks |
| Arena model | 48 × 48 floor, half-foot Upper Deck, moving mechanisms and disposal checks passed |
| Hazard timing | Saws remain retracted until 120 seconds, warn for 0.65 seconds and require physical raised-blade contact |
| Hazard contacts | In-air misses, hammer ownership/cooldown, one hit per hammer strike, screw lifting/reversal and physical Upper Deck ascent passed |
| Lifecycle | Lobby/countdown/finished clock freeze and full rematch hazard reset passed |
| Access controls | Unauthenticated matchmaking and WebSockets, and incorrect passwords, rejected |
| Two-client combat | Countdown, knockout, identical results, automatic reconnect to the same seat, rematch and forfeit passed |
| Real-time arena transport | 1,812 identical hazard snapshots across two clients; first saw damage after the real two-minute lockout |
| Four rooms / eight clients | 29.979 simulation updates per second per room over 20 seconds |
| Room capacity | Fifth room rejected with 503 |

The real-time arena check parks a robot over a locked saw slot, waits for the production clock, then verifies a raised-blade contact event and health loss. Its first contact reduced health from 100 to 96.5 at approximately 120.73 seconds. It does not change the server clock or use a test-only unlock route.

The four-room load test measured 1.208 ms average simulation work per update, a 107 ms maximum snapshot gap, and 92.5 MiB process RSS. Those measurements came from the local server. The free Render blueprint remains limited to two rooms; cloud capacity must be measured separately.

## Browser checks

The rebuilt BattleBox rendered in Chromium without console errors. The arena uses 68 meshes and 32,622 triangles, including 20 hazard mechanisms. Witch Doctor uses 16,224 triangles and 33 meshes; Tombstone uses 8,700 triangles and 19 meshes. Static arena geometry is merged by material. The stage preserves pre-existing robot geometry and releases only its own resources when disposed.

The full-arena inspection view and an 844 × 390 combat viewport reported 60 fps on the test computer. The mobile hammer button visibly entered its server-confirmed swinging state. The three-minute clock, saw-unlock countdown, live screw status, weapon controls and recovery control fit the landscape viewport without horizontal overflow. A 390 × 844 viewport also had no horizontal overflow.

Garage inspection, return to robot view, practice, rematch, hammer activation and leaving the arena were exercised through the interface. Floor graphics were checked for readable orientation. The renderer uses the server's blade height and shared hammer phase durations; a browser timer cannot unlock a saw. Frame-rate measurement uses uncapped frame time, and bot damage materials update only when health changes.

Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

Physical iPhone Safari and Android Chrome performance, touch feel on physical devices, thermal behaviour, cloud-host capacity and the new hazards over real remote connections remain unverified. Exact hazard positions and forces are reconstruction choices; see [arena references](arena-references.md).

Run `pnpm verify:multiplayer`, `pnpm verify:arena-network` and `pnpm verify:load` against a deployed URL to repeat the transport and capacity checks. The arena network check takes about two and a half minutes.
