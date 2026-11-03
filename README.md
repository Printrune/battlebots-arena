# BattleBots Arena

A mobile-first 3D arcade game with private online 1v1 matches, an AI practice opponent, and a chase camera. Choose Witch Doctor or Tombstone, pick a paint colour, and share a match link with a friend.

## Run locally

Install Node.js 24 and pnpm 11.25. Run:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. The local development password is `let-the-bots-battle`. Production requires a separate password and signing secret.

Create a match, share its invitation link, and select **Ready** on both devices. For a solo game, select **Try practice**. Practice starts automatically after the countdown.

## Play

On a phone, rotate to landscape during a match. Use the left stick to drive and steer. Tap the weapon button to toggle the spinner. Tap recovery to right the bot.

On a keyboard, use WASD or the arrow keys to drive, Space to toggle the weapon, and R to recover. Sound is off initially. Use the speaker button to enable it.

Matches last two minutes. A knockout ends a match immediately. Otherwise, the bot with more health wins. Equal health produces a draw.

## Verify changes

```sh
pnpm typecheck
pnpm test
pnpm build
```

With the server running, exercise real clients:

```sh
pnpm verify:multiplayer
pnpm verify:load
```

Set `VERIFY_BASE_URL` to test another server. Set `DEMO_PASSWORD` to its shared game password. The multiplayer check covers login, access rejection, two-player combat, reconnect, rematch, and forfeit. The load check runs four matches with eight clients and verifies the room limit.

## Deploy on Render

1. Push this repository to GitHub.
2. Create a Render Blueprint from the repository and use `render.yaml`.
3. Set a private `DEMO_PASSWORD`. Render generates `SESSION_SECRET`.
4. Deploy the service and open its HTTPS URL.
5. Run the verification scripts against that URL before sharing invitations.

Use the free service for the first small test. It sleeps after inactivity and has compute and bandwidth limits. If warm matches fail the load check because of server resources, upgrade the same service. The client graphics do not change with the hosting tier.

The public repository exposes the source code. The shared game password gates multiplayer access. Passwords and signing keys belong in hosting settings, never client code or GitHub.

## Current boundaries

The two bots are procedural prototype models. Paint changes appearance only. Match state is temporary and resets when the server restarts. Guests can reconnect to their seat for 15 seconds after a dropped connection. The initial server limit is four rooms.

The game has no age gate or date-of-birth collection. Accounts, payments, public matchmaking, spectators, team battles, and real-show activities are future work.

The client uses React and Babylon.js. Colyseus owns rooms, authentication checks, and transport. A separate Rapier simulation owns combat. Shared Zod schemas validate network input and snapshots.

See [release verification](docs/verification.md) for measured results and remaining device checks.
