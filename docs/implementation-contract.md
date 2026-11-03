# Implementation contract

Read the TypeScript and boundary-discipline skills before editing TypeScript. Use the contracts in `src/shared/protocol.ts`. Do not change shared files without coordinating with the primary agent.

## Ownership

- Simulation: `src/server/simulation.ts` and `tests/simulation.test.ts` only.
- Renderer: `src/client/game/**` only.
- Interface: `src/client/App.tsx`, `src/client/main.tsx`, `src/client/styles.css`, `src/client/components/**` only.
- Primary agent: shared contracts, server transport/auth, build config, scripts, deployment, integration.

## Integration

Renderer exports async `createArena(canvas: HTMLCanvasElement): Promise<ArenaRenderer>` from `src/client/game/arena.ts`. Import the ArenaRenderer interface from shared protocol. Use an attract-mode 3D arena and bot preview before a match. `update` supplies authoritative snapshots; `setInput` supplies current local controls. Match camera follows local player from behind; preview camera is cinematic. The UI owns canvas lifetime and calls disposal.

Simulation exports `createSimulation(roomId: string): Promise<Simulation>`. Simulation methods: `addPlayer(id: string, name: string, selection: CosmeticSelection): void`, `removePlayer(id: string): void`, `setConnected(id: string, connected: boolean): void`, `setReady(id: string, ready: boolean): void`, `setInput(id: string, input: PlayerInput, nowMs: number): void`, `step(dt: number, nowMs: number): void`, `snapshot(): MatchState`, `rematch(): void`, `forfeit(id: string): void`, `dispose(): void`. Class/type Simulation exported. Countdowns and completion are simulation-owned. Ready requires two participants; no client-owned health or transform. Input expiry uses nowMs. World is x/z planar with y up; yaw 0 faces +z; chassis length about 2.4, width about 1.8; positions include physical body centre around y=.5.

UI networking imports `{ createConnection }` from `./network` (primary-owned). `createConnection(options)` receives `onState(snapshot: MatchState, localId: string): void`, `onStatus(status: ConnectionStatus): void`, `onError(message: string): void`. It returns a connection with async `create(selection: JoinOptions): Promise<string>`, `join(roomId: string, selection: JoinOptions): Promise<void>`, `reconnect(): Promise<boolean>`, `sendInput(input: PlayerInput): void`, `ready(): void`, `rematch(): void`, `leave(): Promise<void>`, `ping(): void`. `ConnectionStatus` is `'idle'|'connecting'|'connected'|'reconnecting'|'disconnected'`. Auth: `GET /api/session` returns `{ authenticated: boolean, passwordRequired: boolean }`; `POST /api/login` with `{password}` returns authenticated or 401; JSON errors use `{error: string}`. No age gate.

Use ArenaRenderer and shared types. No React state on animation frames. UI can throttle HUD updates to snapshots. Inputs: left virtual joystick throttle/steer, weapon toggle, recover pulse. Keyboard WASD/arrows, Space weapon toggle, R recover. Clear controls on blur, pointercancel, visibilitychange. Input sequence increments per send at 30Hz. Private room URL is `?room=ID`. Practice is a private room with server-driven AI, useful when no friend is available. Preserve real 1v1 as primary.

## Presentation

Industrial sports broadcast style: charcoal/near-black, warm white type, amber accent, restrained acid green. Strong typography, fine grid, precise borders, editorial spacing. No generic gradient dashboard. Main view has bold BattleBots wordmark, top status/nav, editorial arena heading, a large real 3D showcase, two bot cards, paint selection, host/join actions. Mobile menus portrait; active match landscape with a rotate hint. Chase camera, offscreen opponent indicator, readable health and timer, touch-safe controls. No ages or DOB.

## Verification

Run typecheck and relevant meaningful tests. Do not edit another agent's files. Report exact files and any integration blockers. Primary will run deployed-style multi-client verification and browser checks.
