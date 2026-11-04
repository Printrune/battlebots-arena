# VR support

The VR build targets WebXR browsers, with Quest 3 as the first hardware test target. It checks whether the browser can start an `immersive-vr` session. It does not identify support from the headset's brand or user-agent string. Browser support, available input and graphics performance all affect whether a particular headset can play.

No physical headset has been verified yet. Desktop rendering, simulated input and automated checks cannot establish comfort, controller mappings or sustained headset performance.

## Headset targets

| Headset family | Browser route | Status for this game |
| --- | --- | --- |
| Meta Quest 3 and 3S, plus other capable Quest devices | Meta Quest Browser; Wolvic is another WebXR browser | First test target. Actual Quest 3 entry, controllers and performance still need verification. Meta recommends runtime feature detection. [Meta browser specifications](https://developers.meta.com/vr/documentation/web/browser-specs/) |
| PICO 4 family and supported PICO Neo3 devices | A supported Wolvic build; test the installed browser's capabilities | Conditional target. Wolvic lists these device families and the official PICO store describes its immersive WebXR support. [Wolvic supported devices](https://www.wolvic.com/en/faq/), [official PICO listing](https://store-global.picoxr.com/global/detail/1/7171016990772166662) |
| Android XR headsets | Chrome for Android XR | Conditional target. Google documents WebXR, gamepad and hand-input support. Actual inputs and frame rate still need verification. [Android XR web development](https://developer.android.com/develop/xr/web) |
| Apple Vision Pro | Safari on visionOS with immersive WebXR support | Conditional target. Safari 18 on visionOS 2 introduced `immersive-vr`. Hand/gaze interaction must work through the in-world controls; controller-only input is insufficient. [WebKit's WebXR announcement](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/) |
| PC VR headsets | A compatible Windows browser and working OpenXR runtime | Conditional target. Chromium's Windows WebXR support requires an OpenXR runtime implementing its required app-container extension. A headset working in a native VR game does not prove browser compatibility. [Chromium platform support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/) |
| PlayStation VR2 | Potential PC route with Sony's PC adapter and compatible browser/runtime | No PS5 console release is provided. Sony documents its PC adapter route to SteamVR; browser compatibility remains a separate test. [PlayStation VR2 PC support](https://www.playstation.com/en-us/support/hardware/psvr2/) |

Newer hardware can use the same route when it exposes the required WebXR session and input capabilities. This is a compatibility target, not a promise that every new headset works.

## View and controls

The player stays at a fixed driver station beside the BattleBox. Head movement changes the view naturally. Bot launches, recoil and defeat camera movement must not move the VR viewer. The arena remains in feet; WebXR tracking uses meters, converted at approximately 3.28084 feet per meter.

Supported controller thumbsticks drive and steer. Weapon, recovery and pulverizer actions use mapped controller buttons. Labels differ between controller profiles, so the in-world panel also exposes actions and directional driving controls for ray, hand or gaze input. The panel includes ready, rematch, leave, recenter and exit controls. The normal HTML interface cannot be assumed visible inside an immersive session.

Controls must return to neutral when the XR session loses focus, a driving input is released, a controller disconnects or VR exits. Network driving updates must follow XR frames while immersive content is active. A desktop animation loop or a hidden-page timer is insufficient for that task.

## Opening the game on Quest 3

1. Open the game's GitHub Pages HTTPS address in Meta Quest Browser.
2. Start solo practice. The Pages build does not require a password or a game server.
3. Select the game's VR entry control and accept the browser's immersive-session prompt.
4. Confirm the arena scale and use recenter if the driver station needs adjustment.

`http://127.0.0.1:3000/` is local to the computer running the server. On the headset, that address refers to the headset itself. A normal LAN address over plain HTTP also does not provide the secure context required by WebXR. Use a trusted HTTPS deployment or a properly configured trusted local HTTPS origin. [WebXR secure-context and session requirements](https://www.w3.org/TR/webxr/)

## Free GitHub Pages hosting

The static build runs on GitHub Pages over HTTPS. Solo practice runs the same Rapier match simulation and opponent AI in a dedicated Web Worker on the player's device. The worker handles countdown, impacts, damage, hazards, defeat explosions and rematches. It advances from its timer and input messages through a single bounded physics clock, so an XR frame can keep the match responsive when browser page timers are throttled.

Run `pnpm build:pages`, which sets `VITE_STATIC_HOSTING=true` and `VITE_BASE_PATH=/battlebots-arena/`. Vite builds the worker and resolves bundled assets under that project path. The Pages workflow publishes `dist/pages`. A repository hosted at a different project path needs the corresponding base path.

GitHub Pages provides static files; it does not run a Node or WebSocket game server. The static build therefore provides solo practice and VR practice. Online create/join options require a separately hosted multiplayer server. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

No headset hardware test has been completed. Local static-build and simulation tests do not establish that a deployed Pages URL is reachable or fast enough on Quest 3.

## Optional online server

The current server serves the client, login, matchmaking and WebSockets from one origin. It listens on the configured port on all interfaces and already trusts one proxy. Keeping these parts on one HTTPS/WSS web service preserves the current session-cookie and WebSocket-origin checks. A static-only host does not run the Colyseus/Rapier server.

The existing `render.yaml` provides a possible server test route if multiplayer hosting is added. Render documents free Node web services, managed TLS and inbound WebSockets. Its free services sleep after fifteen minutes without inbound traffic and can take about a minute to wake. Bandwidth, build minutes and workspace instance-hour limits apply. Keep the blueprint's two-room limit until the deployed host passes load testing. [Render free services](https://render.com/docs/free), [Render WebSockets](https://render.com/docs/websocket), [Render TLS](https://render.com/docs/tls)

The online server has no public deployment. Its hosting account and capacity have not been verified.

## Physical verification before claiming support

- Confirm VR entry and exit, both eyes, natural head tracking and correct arena scale.
- Test forward, reverse, both steering directions, stationary pivots and all action buttons.
- Test ray or hand/gaze controls when the device has no usable thumbsticks.
- Open the headset system menu, remove controller tracking and resume. The bot must stop while input is unavailable.
- Exercise ready, countdown, combat, knockout, rematch and leave using only the in-world interface.
- Confirm explosions and launched bots never move or shake the viewer.
- Run sustained fights with both damaged bots, detached parts and active hazards. Measure headset frame time and heat on each device.
- Verify a real remote two-client match over HTTPS/WSS, including dropped connection and reconnect.

Record the headset, operating-system version, browser version, controller/input profile and measured results for each verified combination.
