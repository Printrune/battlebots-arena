# BattleBots Arena

A mobile-first 3D arcade game with private online 1v1 matches, an AI practice opponent, and a chase camera. Choose Witch Doctor or Tombstone, pick a paint colour, and share a match link with a friend.

## Run locally

Install Node.js 24 and pnpm 11.25. Run:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. The development fallback password is `let-the-bots-battle`. A `DEMO_PASSWORD` in `.env` overrides it. Production requires a separate password and signing secret.

Create a match, share its invitation link, and select **Ready** on both devices. For a solo game, select **Try practice**. Practice starts automatically after the countdown.

## Play

On a phone, rotate to landscape during a match. Use the left stick to drive and steer. Tap the weapon button to toggle the spinner. Tap recovery to right the bot.

On a keyboard, use WASD or the arrow keys to drive, Space to toggle the weapon, R to recover, and H to operate your two corner pulverizers. The same controls have touch buttons. Sound is off initially. Use the speaker button to enable it.

In the garage, drag the 3D view to inspect a bot from different angles. Use the mouse wheel to zoom. Witch Doctor has an active ribcage self-righter. Tombstone drives inverted and has no active self-righting control. Weapons spin up gradually, coast after power is cut, and lose speed after impacts.

Matches last three minutes. A knockout ends a match immediately. Otherwise, the bot with more health wins. Equal health produces a draw.

Hits damage individual wheels, armor panels and the weapon assembly at the contact point. Dents, gouges, scorch marks and tire damage persist through the fight. Wheels and detachable armor can break off into physical debris. Missing wheels reduce speed and pull the bot toward one side, while a limp mode preserves steering. Losing all powered wheels starts a ten-second grounded count-out; the weapon and assigned hammers remain available.

Watch the wheel indicators and weapon status beside the hull display. A damaged weapon spins up more slowly, and a destroyed motor cannot restart its rotor. Stored spinner inertia still coasts down. Rematches repair every component and remove debris. Damage and detached parts are server-owned and survive reconnecting. Durability and handling penalties are tuned for play rather than measured failure loads.

The BattleBox reconstructs the WCVII-era enclosure, worn steel floor, clear protective panels, corner pulverizers and Upper Deck. The screws operate throughout combat and reverse when a robot jams them. Each team operates two corner hammers. Killsaws stay retracted for the first two minutes, then warn before rising beneath nearby robots in the final minute. Arena damage and lifting impulses run on the server. Hazard hits are tracked separately from weapon-hit counts.

Select **Inspect BattleBox** in the garage for a full-arena view. Drag to orbit and scroll to zoom. [Arena sources](docs/arena-references.md) distinguish verified dimensions and operation from approximate hazard positions and force values.

## Verify changes

```sh
pnpm typecheck
pnpm test
pnpm verify:models
pnpm verify:damage-models
pnpm verify:arena
pnpm build
```

With the server running, exercise real clients:

```sh
pnpm verify:multiplayer
pnpm verify:load
pnpm verify:arena-network
pnpm verify:damage-network
```

Set `VERIFY_BASE_URL` to test another server. Set `DEMO_PASSWORD` to its shared game password. The multiplayer check covers login, access rejection, two-player combat, reconnect, rematch, and forfeit. The load check runs four matches with eight clients and verifies the room limit.

The arena network check runs the real two-minute killsaw lockout with two clients. It verifies identical hazard states, hammer ownership, and a physical saw hit after unlocking. Allow about two and a half minutes.

The damage network check drives into an exposed wheel through normal combat. It verifies detachment before hull knockout, shared rigid debris, persistent damage after reconnecting, and repaired components on rematch. The model damage check verifies real geometry changes, missing assemblies, independent debris geometry and complete restoration without resource leaks.

## Deploy on Render

1. Push this repository to GitHub.
2. Create a Render Blueprint from the repository and use `render.yaml`.
3. Set a private `DEMO_PASSWORD`. Render generates `SESSION_SECRET`.
4. Deploy the service and open its HTTPS URL.
5. Run the verification scripts against that URL before sharing invitations.

Use the free service for the first small test. It sleeps after inactivity and has compute and bandwidth limits. If warm matches fail the load check because of server resources, upgrade the same service. The client graphics do not change with the hosting tier.

The public repository exposes the source code. The shared game password gates multiplayer access. Passwords and signing keys belong in hosting settings, never client code or GitHub.

## Current boundaries

The models reconstruct WCVII Witch Doctor and classic 2021 Tombstone from nine primary-source reference photos. They include mechanical frame details, rubber tyres, PBR metal and paint, and locally bundled photo-derived signature graphics. [Photo references and mechanical sources](docs/bot-references.md) document the selected configurations.

Wheel traction, spinner contact volumes, recoil, coasting, gyroscopic effects, inverted driving, and motor-driven recovery run on the server. Dimensions and force coefficients are game-space approximations rather than team CAD or measured telemetry. Paint changes appearance only.

Match state is temporary and resets when the server restarts. Guests can reconnect to their seat for 15 seconds after a dropped connection. Local configuration supports four rooms. The free Render blueprint starts at two rooms to leave CPU headroom for the richer physics. For that deployment, set `VERIFY_LOAD_ROOMS=2` when running the load check. Benchmark the actual hosting tier before increasing capacity.

The game has no age gate or date-of-birth collection. Accounts, payments, public matchmaking, spectators, team battles, and real-show activities are future work.

The client uses React and Babylon.js. Colyseus owns rooms, authentication checks, and transport. A separate Rapier simulation owns combat. Shared Zod schemas validate network input and snapshots.

See [release verification](docs/verification.md) for measured results and remaining device checks.
