# Release verification

The local production build was verified on 3 November 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Simulation and authentication | 10 tests passed |
| Production client and server builds | Passed |
| Unauthenticated HTTP matchmaking | Rejected with 401 |
| Wrong password | Rejected with 401 |
| Unauthenticated WebSocket | Rejected |
| Two-client match | Distinct seats, countdown, authoritative knockout, identical outcome |
| Dropped connection | Automatic reconnect restored the same seat |
| Rematch | Restored health and readiness |
| Consented departure during combat | Correct forfeit outcome |
| Four rooms and eight clients | 30.0015 simulation updates per second per room over 20 seconds |
| Capacity overflow | Fifth room rejected with 503 |

The four-room load test measured an average simulation step of 0.1874 ms and process RSS of 91.05 MiB. The maximum snapshot gap was 141 ms. These measurements came from the local release server, not a free cloud instance.

## Browser checks

The release build rendered the procedural BattleBox and both bots in Chromium. The preview reported 60 fps on the test computer. The garage fit a 390 by 844 viewport without horizontal overflow. The match fit an 844 by 390 viewport with a working chase camera, health bars, touch controls, and weapon power display.

Password login, practice, ready, weapon activation, keyboard driving, health changes, knockout results, rematch, and return to the garage were exercised through the interface. Browser testing found and fixed a missing Babylon instancing registration and an overlay that intercepted match utility controls.

Screenshots are stored locally in `.local/screenshots` and excluded from Git.

## Remaining external checks

Physical iPhone Safari and Android Chrome performance, touch feel on physical devices, five-minute thermal behaviour, and cloud-host capacity remain unverified. Complete those checks before describing the build as a public production release.

Run `pnpm verify:multiplayer` and `pnpm verify:load` against the deployed URL to repeat the network checks.
