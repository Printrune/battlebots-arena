# BattleBots Arena

A mobile-first 3D arcade game with private online 1v1 matches, an AI practice opponent, and a chase camera. Choose Witch Doctor or Tombstone, pick a paint colour, and share a match link with a friend.

## Free GitHub practice and VR

The GitHub Pages edition runs solo practice in a browser worker. It uses the same Rapier simulation, opponent, damage, hazards and rematches as the server build. It needs no game server or password. GitHub Pages cannot host the live multiplayer server; online matches remain available in the server edition.

Play the free edition at [printrune.github.io/bb](https://printrune.github.io/bb/).

Build the static edition with `pnpm build:pages`. The output is `dist/pages`, with assets rooted at `/bb/`. The Pages workflow publishes it over HTTPS from `codex/arena-demo`.

In a compatible headset browser, start a match and select **VR**. Practice waits in the lobby before combat. Version 0.7.5 uses a third-person chase view with native head tracking and a thin, read-only health and clock strip. VR has no screen buttons or pointer rays. The left stick drives. Right A or the right trigger readies, toggles the weapon or requests a rematch, depending on match state. Right B operates recovery, left X uses pulverizers and left Y recenters. Exit through the headset's native system menu.

The user confirmed working immersive VR on a physical Quest 3 with v0.7.4. The v0.7.5 chase view and controller-only interface need a physical retest. Other headsets use runtime WebXR detection and require usable gamepad controls. Compatibility and sustained frame rate remain unverified on those devices. See [VR support and setup](docs/vr-support.md).

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

The defeated robot explodes after a knockout or time decision, scattering its remaining wheels and detachable armor. The camera follows the blast briefly before showing the result. The explosion cannot damage the winner. Mutual knockouts destroy both bots; a tied time decision or forfeit has no explosion. Rematches clear the smoke and debris and rebuild both robots.

Steering follows the direction of travel: backing up reverses the turning arc, while steering with no throttle still pivots in place. Keyboard controls, the touch joystick, server handling and local prediction share this rule.

Hits damage individual wheels, armor panels and the weapon assembly at the contact point. Dents, gouges, scorch marks and tire damage persist through the fight. Wheels and detachable armor can break off into physical debris. Missing wheels reduce speed and pull the bot toward one side, while a limp mode preserves steering. Losing all powered wheels starts a ten-second grounded count-out; the weapon and assigned hammers remain available.

Watch the wheel indicators and weapon status beside the hull display. A damaged weapon spins up more slowly, and a destroyed motor cannot restart its rotor. Stored spinner inertia still coasts down. Rematches repair every component and remove debris. Damage and detached parts are server-owned and survive reconnecting. Durability and handling penalties are tuned for play rather than measured failure loads.

Hull life is shown as current/100 in the top HUD and above each bot. Bars turn amber and red as life falls, with a short trailing strip showing recent damage. Witch Doctor's vertical weapon can launch and pitch opponents; Tombstone's horizontal bar cuts sideways and recoils. Off-center hits create rotation. Airborne bots follow gravity and cannot accelerate by steering in empty space. Hard floor landings can cause further localized damage; normal rolling and small floor bumps do not.

The BattleBox reconstructs the WCVII-era enclosure, worn steel floor, clear protective panels, corner pulverizers and Upper Deck. The screws operate throughout combat and reverse when a robot jams them. Each team operates two corner hammers. Killsaws stay retracted for the first two minutes, then warn before rising beneath nearby robots in the final minute. Arena damage and lifting impulses run on the server. Hazard hits are tracked separately from weapon-hit counts.

Select **Inspect BattleBox** in the garage for a full-arena view. Drag to orbit and scroll to zoom. [Arena sources](docs/arena-references.md) distinguish verified dimensions and operation from approximate hazard positions and force values.

## Verify changes

```sh
pnpm typecheck
pnpm test
pnpm verify:models
pnpm verify:damage-models
pnpm verify:life-bars
pnpm verify:explosions
pnpm verify:vr-hud
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

Rapier advances at 60 Hz under the 30 Hz room update. The simulation uses feet, kilograms and seconds consistently. Rotor inertia/energy, actual contact-point velocity and effective rigid-body mass determine hit impulses, reciprocal recoil and damage. Continuous collision detection, actual support contacts and hard-landing checks share the same world. [Impact and flight design](docs/impact-design.md) records the approximations and primary engine references.

See [release verification](docs/verification.md) for measured results and remaining device checks.
