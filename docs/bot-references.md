# Robot photo and behaviour references

The model baselines are World Championship VII Witch Doctor, filmed in 2022 and broadcast in 2023, and 2021 Tombstone. Do not mix in the Destruct-A-Thon Witch Doctor showbot or the redesigned 2026 Tombstone. The project owner has authorized use of branding and images.

Run `node scripts/fetch-bot-references.mjs` from the repository root to fetch missing selected images and rebuild `assets/reference/manifest.json`. Existing images are reused. The manifest records each exact image URL, source page, angle, caption, dimensions, byte count, actual image format, and SHA-256. The selected photos were individually inspected. Three Squarespace photos arrive as WebP despite their upstream `.jpg` URLs, so local extensions reflect their real format. These are reference assets, not a public gallery; the client can publish the two clean official robot portraits separately.

## Photo guide

All paths below are relative to `assets/reference/`.

| Robot | File | Use |
| --- | --- | --- |
| Witch Doctor | `witch-doctor-wcvii/studio-front-three-quarter.jpg` | Intact official WCVII shape, front plows, disc, uprights, palette, rib graphics. |
| Witch Doctor | `witch-doctor-wcvii/action-versus-jackpot.jpg` | Intact elevated rear three-quarter, spine and ribs, rear plate, wheel sizes and tread. Team website image has a purple gradient on its right side. |
| Witch Doctor | `witch-doctor-wcvii/pit-front-top-damaged.webp` | Front/top construction, four wheels, body panels, single thick disc and supports. Damaged quarterfinal configuration. |
| Witch Doctor | `witch-doctor-wcvii/pit-weapon-detail-damaged.webp` | Exposed weapon hub, bearings, pulley and rails. Do not use broken supports as intact geometry. |
| Witch Doctor | `witch-doctor-wcvii/pit-ribcage-chain-detail.webp` | Side wheels, green hubs, larger rear wheel, detached ribcage plate and self-righter chain. |
| Tombstone | `tombstone-2021/studio-front-three-quarter.jpg` | Official 2021 baseline. Two unguarded rear wheels, triangular cutout frame, top vents and artwork, large horizontal bar with lightening holes. |
| Tombstone | `tombstone-2021/team-portrait-bot-front.jpg` | Opposite front three-quarter within official 2021 team portrait; shows the alternate silver bar with red end caps. |
| Tombstone | `tombstone-2021/action-versus-jackpot-2021.jpg` | Team-labelled 2021 action photo; rear/side plate, wheel exposure and contact sparks. |
| Tombstone | `tombstone-2021/classic-one-wheel-action.jpg` | Team-published older classic robot balancing on one wheel. Season is unspecified. Recoil reference only, not a source for 2021 appearance. |

The Witch Doctor pit photographs come from the opponent team's dated [WCVII fight report](https://hugebattlebots.com/team-huge-battlebots-blog/huge-vs-witch-doctor). Its image credits include Dan Longmire and Jon C. R. Bennett. The intact action image is published by [Team Witch Doctor](https://www.teamwitchdoctor.com/), and its filename credits Jon C. R. Bennett. The clean portraits and Tombstone team portrait are from [BattleBots Witch Doctor WCVII](https://battlebots.com/robot/witch-doctor-wcvii/) and [BattleBots Tombstone 2021](https://battlebots.com/robot/tombstone-2021/). Tombstone action photos are selected from [Hardcore Robotics](https://hardcorerobotics.com/).

## Verified mechanical facts

Witch Doctor's official WCVII classification is a vertical disc spinner. Its 2023 team AMA confirms the single-disc choice, brushless weapon drive, and a chain-driven ribcage self-righter powered by a geared brushed DC motor. The team reports an approximately 45 lb disc, near 250 mph maximum tip speed, and roughly 13 mph drive speed. The team presents the weight and drive speed as remembered approximations. It also confirms that the robot can drive inverted on its rear wheels and bunny ears, with the weapon kept clear of the floor; the team prefers to self-right for effective weapon orientation. The lighter single disc spins up faster than its former twin-disc configuration, and higher weapon speed increases gyroscopic effects. [Team Witch Doctor 2023 AMA](https://www.reddit.com/r/battlebots/comments/13qoq1o/witch_doctor_ama_9pm_est/)

The official Tombstone 2021 profile identifies a horizontal bar spinner. The inspected photos show two large wheels, a long narrow nose around the weapon axle, exposed chain, and an open triangular frame. Ray Billings' March 2021 AMA reports roughly 9 mph drive speed, a slight downward angle to the bar, and that weapon contact can pull opponents toward Tombstone's right wheel and motor. He says exact actual weapon RPM had not been measured and distinguishes theoretical tip speed from real operation. [Tombstone 2021 profile](https://battlebots.com/robot/tombstone-2021/), [Ray Billings 2021 AMA](https://www.reddit.com/r/battlebots/comments/lyptp2/tombstone_ama_ask_me_anything/)

## Simulation limits

Photographs provide proportions and construction cues, not calibrated dimensions. No reviewed primary source establishes one exact RPM for either selected build. Store game RPM, spin-up duration, friction and impact coefficients as documented approximations. Keep weapon plane and contact direction distinct: Witch Doctor's front contact can lift an opponent, while Tombstone's bar produces lateral strikes and chassis recoil. The latter direction is a simulation interpretation of the weapon geometry, not a measured force specification. The reviewed material does not verify a universal clockwise/counterclockwise setting. Classic Tombstone photos show no dedicated active self-righting arm; do not invent one.
