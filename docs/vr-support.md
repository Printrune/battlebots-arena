# VR support

The VR build targets WebXR browsers, with Quest 3 as the first hardware test target. It checks whether the browser can start an `immersive-vr` session. It does not identify support from the headset's brand or user-agent string. Browser support, available input and graphics performance all affect whether a particular headset can play.

The user confirmed working immersive VR on a physical Quest 3 with v0.7.4. The v0.7.5 chase view and controller-only interface still need a physical retest. Emulation does not establish comfort or sustained headset performance.

## Headset targets

| Headset family | Browser route | Status for this game |
| --- | --- | --- |
| Meta Quest 3 and 3S, plus other capable Quest devices | Meta Quest Browser; Wolvic is another WebXR browser | Quest 3 immersive VR worked in the user's v0.7.4 test. The v0.7.5 view and input changes, other Quest devices, and sustained performance need verification. [Meta browser specifications](https://developers.meta.com/vr/documentation/web/browser-specs/) |
| PICO 4 family and supported PICO Neo3 devices | A supported Wolvic build; test the installed browser's capabilities | Conditional target. Wolvic lists these device families and the official PICO store describes its immersive WebXR support. [Wolvic supported devices](https://www.wolvic.com/en/faq/), [official PICO listing](https://store-global.picoxr.com/global/detail/1/7171016990772166662) |
| Android XR headsets | Chrome for Android XR | Conditional target. Google documents WebXR, gamepad and hand-input support. Actual inputs and frame rate still need verification. [Android XR web development](https://developer.android.com/develop/xr/web) |
| Apple Vision Pro | Safari on visionOS with immersive WebXR support | Unverified. The game currently requires usable gamepad controls and has no hand/gaze driving interface. Browser WebXR support alone is insufficient. [WebKit's WebXR announcement](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/) |
| PC VR headsets | A compatible Windows browser and working OpenXR runtime | Conditional target. Chromium's Windows WebXR support requires an OpenXR runtime implementing its required app-container extension. A headset working in a native VR game does not prove browser compatibility. [Chromium platform support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/) |
| PlayStation VR2 | Potential PC route with Sony's PC adapter and compatible browser/runtime | No PS5 console release is provided. Sony documents its PC adapter route to SteamVR; browser compatibility remains a separate test. [PlayStation VR2 PC support](https://www.playstation.com/en-us/support/hardware/psvr2/) |

Newer hardware can use the same route when it exposes the required WebXR session and input capabilities. This is a compatibility target, not a promise that every new headset works.

## View and controls

Version 0.7.5 follows the player's bot with the same third-person chase view as mobile. The tracking parent follows the chase position and heading. WebXR retains the native head pose and stereo eye separation. Bot roll, recoil, camera shake and defeat cinematics do not drive the VR camera.

The arena remains in feet. WebXR tracking uses meters, converted at approximately 3.28084 feet per meter. A valid viewer pose is required before the tracking parent is anchored. Controller input uses an offline generic-trigger profile. A fatal XR rendering error ends the session and reports the reason in the browser.

VR has no screen buttons, tablet, pointer rays or hand/gaze driving controls. A thin, read-only strip above the view shows both bots' health, the match clock and match status. The strip uses one non-pickable plane, one material and one texture atlas. The normal HTML interface is hidden during immersive VR.

| Quest controller | Action |
| --- | --- |
| Left thumbstick | Drive and steer |
| Right A or right trigger | Ready in the lobby, weapon toggle during combat, rematch after the result |
| Right B | Self-right Witch Doctor |
| Left X | Pulverizers |
| Left Y | Recenter |
| Native Meta system menu | Exit immersive VR |

Button labels vary across controller profiles. The input reader uses the left stick when available, with a single-controller fallback. Devices without usable gamepad controls do not currently have a driving interface.

Controls return to neutral when the session loses focus, tracking becomes unavailable, a controller disconnects or VR exits. The XR frame samples and publishes driving input. The read-only strip follows the current head pose after the chase view updates.

## Opening the game on Quest 3

1. Open the game's GitHub Pages HTTPS address in Meta Quest Browser.
2. Start solo practice. The Pages build does not require a password or a game server.
3. Select **VR** and accept the browser's immersive-session prompt. Practice waits in the lobby when VR is available.
4. Press right A or the right trigger to ready. Left Y recenters the view. Exit through the native Meta system menu.

`http://127.0.0.1:3000/` is local to the computer running the server. On the headset, that address refers to the headset itself. A normal LAN address over plain HTTP also does not provide the secure context required by WebXR. Use a trusted HTTPS deployment or a properly configured trusted local HTTPS origin. [WebXR secure-context and session requirements](https://www.w3.org/TR/webxr/)

## Free GitHub Pages hosting

The static build runs on GitHub Pages over HTTPS. Solo practice runs the same Rapier match simulation and opponent AI in a dedicated Web Worker on the player's device. The worker handles countdown, impacts, damage, hazards, defeat explosions and rematches. It advances from its timer and input messages through a single bounded physics clock, so an XR frame can keep the match responsive when browser page timers are throttled.

Open [printrune.github.io/bb](https://printrune.github.io/bb/) to play. Run `pnpm build:pages`, which sets `VITE_STATIC_HOSTING=true` and `VITE_BASE_PATH=/bb/`. Vite builds the worker and resolves bundled assets under that project path. The Pages workflow publishes `dist/pages`. A repository hosted at a different project path needs the corresponding base path.

GitHub Pages provides static files; it does not run a Node or WebSocket game server. The static build therefore provides solo practice and VR practice. Online create/join options require a separately hosted multiplayer server. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

The user confirmed the deployed v0.7.4 game worked in immersive VR on Quest 3. The v0.7.5 chase view still needs a physical retest and sustained frame-time measurements.

## Optional online server

The current server serves the client, login, matchmaking and WebSockets from one origin. It listens on the configured port on all interfaces and already trusts one proxy. Keeping these parts on one HTTPS/WSS web service preserves the current session-cookie and WebSocket-origin checks. A static-only host does not run the Colyseus/Rapier server.

The existing `render.yaml` provides a possible server test route if multiplayer hosting is added. Render documents free Node web services, managed TLS and inbound WebSockets. Its free services sleep after fifteen minutes without inbound traffic and can take about a minute to wake. Bandwidth, build minutes and workspace instance-hour limits apply. Keep the blueprint's two-room limit until the deployed host passes load testing. [Render free services](https://render.com/docs/free), [Render WebSockets](https://render.com/docs/websocket), [Render TLS](https://render.com/docs/tls)

The online server has no public deployment. Its hosting account and capacity have not been verified.

## Remaining physical verification

- Confirm VR entry and exit, both eyes, natural head tracking and correct arena scale.
- Test forward, reverse, both steering directions, stationary pivots and all action buttons.
- Confirm each target headset exposes usable gamepad controls. There is currently no hand/gaze driving fallback.
- Open the headset system menu, remove controller tracking and resume. The bot must stop while input is unavailable.
- Exercise ready, countdown, combat, knockout and rematch through controller buttons, then exit through the native system menu.
- Confirm chase motion remains comfortable during turns, launches and explosions. Check that no shake or bot roll reaches the view.
- Run sustained fights with both damaged bots, detached parts and active hazards. Measure headset frame time and heat on each device.
- Verify a real remote two-client match over HTTPS/WSS, including dropped connection and reconnect.

Record the headset, operating-system version, browser version, controller/input profile and measured results for each verified combination.
