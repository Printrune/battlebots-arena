# Release verification

The local production build was verified on 3 November 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Simulation and authentication | 21 tests passed |
| Photo-derived model checks | Eight robot and paint variants passed floor, geometry, wheel, recovery, and resource-disposal checks |
| Production client and server builds | Passed |
| Unauthenticated HTTP matchmaking | Rejected with 401 |
| Wrong password | Rejected with 401 |
| Unauthenticated WebSocket | Rejected |
| Two-client match | Distinct seats, countdown, authoritative knockout, identical outcome |
| Dropped connection | Automatic reconnect restored the same seat |
| Rematch | Restored health and readiness |
| Consented departure during combat | Correct forfeit outcome |
| Simulated 150 ms round-trip latency | Login, join, reconnect, knockout, rematch, and forfeit passed |
| Four rooms and eight clients | 29.9356 simulation updates per second per room over 20 seconds with the reconstructed bot physics |
| Capacity overflow | Fifth room rejected with 503 |

The four-room load test measured an average simulation step of 0.9403 ms and process RSS of 93.5 MiB. The maximum snapshot gap was 370 ms. These measurements came from the local release server, not a free cloud instance. The free Render blueprint starts with two rooms because four rooms' measured simulation work exceeds that tier's nominal CPU allowance.

## Browser checks

The release build rendered the BattleBox and both reconstructed bots in Chromium. Their PBR surfaces include local reflection lighting and photo-projected signature liveries. Witch Doctor uses 16,224 triangles and 33 meshes; Tombstone uses 8,700 triangles and 19 meshes. The preview reported 60 fps on the test computer.

The garage fit a 390 by 844 viewport without horizontal overflow. The match fit an 844 by 390 viewport with a working chase camera, health bars, touch controls, and weapon display. The garage now supports drag-to-inspect and wheel zoom. Server snapshots drive wheel speeds, rotor RPM, roll and pitch, and Witch Doctor's recovery animation.

Password login, practice, ready, weapon activation, keyboard driving, health changes, knockout results, rematch, and return to the garage were exercised through the interface. Browser testing found and fixed a missing Babylon instancing registration and an overlay that intercepted match utility controls.

The realism revision passed 19 simulation checks plus two authentication checks. The model check exercised both bots in all four paint variants and verified disposal, wheel counts, ground alignment, and geometry budgets. The final candidate also completed a real two-client knockout, forced reconnect, rematch, and forfeit under 150 ms simulated round-trip latency.

Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

Physical iPhone Safari and Android Chrome performance, touch feel on physical devices, five-minute thermal behaviour, and cloud-host capacity remain unverified. Complete those checks before describing the build as a public production release.

Run `pnpm verify:multiplayer` and `pnpm verify:load` against the deployed URL to repeat the network checks.
