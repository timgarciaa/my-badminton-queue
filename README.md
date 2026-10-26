# MBQ — My Badminton Queue

iPad web app (PWA) for running badminton sessions: master player list, check-in, a first-come-first-served court queue with balanced doubles, shuttlecock count, and an equal cost split per head.

## Features

- **Players** — master list with gender and skill level (Beginner, Low-Int, Intermediate, High-Int, Advanced). Archive players who stop coming. **Import list** takes a pasted list (one name per line, numbering ignored); then use **Needs gender** and the inline M/F and 1–5 buttons to fill in each player.
- **Check-in** — tap a name under "Not here yet" to check them in (in arrival order); a short Undo bar catches mistakes. Tapping never checks anyone out: "Check out" is a separate, confirmed button, only for players who haven't played yet.
- **Phone check-in** — on Check-in, tap **Phone check-in**, set a 4-digit PIN, and get a QR code and link for this session. Players scan it, enter the PIN (tell them at the venue, so a forwarded link alone can't check anyone in), tap their name and are checked in at the time they arrived; the iPad picks them up within a few seconds. Someone not on the list can type their name, and it waits on the iPad to be added (or matched to a player, or dismissed). Turn it on (or reopen the QR code) any time during the session; the PIN can be changed from the same dialog, and after 30 wrong PINs it stops working until you change it. The link stops working when the session ends or you tap Turn off. Needs the check-in API below.
- **Courts** — 1–6 courts. "Next game" takes the first 4 in the queue and splits them into the two most even teams (avoiding a recent repeat partner). "Re-pair" tries another split, "Undo" sends the 4 back to the front. "End game" sends them to the back of the queue.
- **Partner rotation** — MBQ remembers every partnership in the session and prefers fresh partners, accepting a slightly less even game (up to 2 skill points) to avoid a repeat. It never makes a lopsided game just to rotate.
- **Mixed pairs** — when two splits are equally balanced on skill, MBQ prefers one male + one female per team.
- **Games & records** — when ending a game, tap the winning team. The Games tab lists every finished game (tap a team to correct the winner) and a win/loss table for this session or all time. Players also shows each player's all-time W–L.
- **Balance along the way** — if the next 4 would be a rematch (nearly the same four as an earlier game), repeat a partnership or make a lopsided game, MBQ automatically swaps one of them with the 5th or 6th player in line when you tap Next game. The queue previews the swap, the court shows who swapped in, and Undo reverses it.
- **Queue preview** — the queue shows the next game split into its two teams (teal vs amber), exactly as the next court will start it, followed by the numbered waiting list. Drag a player's ⠿ grip onto another player, or tap two players, to swap them (between teams or with someone waiting). Manual changes fix the next game's teams as shown ("Set by hand") and pause automatic swaps until that game starts; tap **Auto** to undo them.
- **Game numbers** — each game gets a number in start order, shown on the court and in the Games tab.
- **Rest** — take a player out of the queue without removing them from the session (they still pay).
- **Costs** — (court fee + shuttles used × shuttle price) ÷ players present, rounded up to the next whole peso (no centavos). Shuttles are reused, so a game starts at 0 — tap + on the court when a new shuttle is opened. Adjust the total on Costs if needed. Tap a player to mark them paid.
- **Sign in and clubs** — organizers sign in (username and password) before using the app. New organizers tap **Create an account** to either create a club (approved by the app admin) or join one with its join code (approved by any of that club's organizers, in Settings, where a badge shows who's waiting). Until approved, signing in shows "Waiting for approval". An offline iPad that already has data can **Continue offline**, so a session still runs at a court with no signal.
- **Club account** — once signed in, the iPad saves its players, current session and past sessions to the club in the cloud. The iPad keeps working from its own copy, so a session never waits on the internet: changes go up a few seconds later, or once it's back online. The header shows the club and whether everything is saved. Signing in on a new device brings the club's data down; if both the club and the iPad already have different data, you pick which to keep. If another device saved in the meantime, nothing is overwritten: a banner asks whether to use the club's data or keep this iPad's.
- **Settings** — club account, export/import a JSON backup, discard the current session, view past sessions.

Data is stored in the browser on the device (localStorage), and also in the club's cloud data when an organizer is signed in. Export a backup regularly.

## Development

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit tests for queue, balancing, cost split
pnpm build      # production build in dist/
```

### Deploy

Every push to `main` runs the tests, builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`:
https://timgarciaa.github.io/my-badminton-queue/

### API on AWS (phone check-in, club accounts)

Phone check-in and club accounts go through a small API in `server/`, deployed as one CloudFormation stack (`mbq-checkin`):

- one Lambda function with a public URL (`lambda.mjs`; check-in in `checkin.mjs`, club data in `club.mjs`, sign-in checks in `auth.mjs`)
- a DynamoDB table for open check-ins (each removed a day later)
- a DynamoDB table for club data (one item per document: players, current session, each past session), with 35-day point-in-time recovery
- a Cognito user pool for organizer accounts: username and password only, no email; made by the app's sign-up (or `server/club.sh`), with which club each organizer belongs to in the club table

At a session a week it stays within the AWS free tier, apart from a few cents a month of DynamoDB writes.

1. Sign the AWS CLI in to the account, under its own profile: `aws login --profile personal --region ap-southeast-1`. Check it with `aws sts get-caller-identity --profile personal`.
2. `AWS_PROFILE=personal pnpm checkin:deploy` (region `ap-southeast-1` unless `AWS_REGION` is set). It creates or updates the stack from `server/template.yaml`, uploads the function code and prints the settings for the app. Safe to run again.
3. Put those settings (`VITE_CHECKIN_API`, `VITE_AUTH_URL`, `VITE_COGNITO_CLIENT_ID`) in `.env.production`, commit and push.

Clubs and organizers (`AWS_PROFILE=personal pnpm club <command>`):

- `requests` lists new clubs waiting for approval; `approve-club <club-id>` lets one in, `decline-club <club-id>` deletes it and its organizer's account. Approving also works by setting the club's `approved` to `true` in the DynamoDB console (club table, item `pk` = `club#<id>`, `sk` = `meta`).
- `clubs` lists clubs with their join codes; `organizers` lists who organizes which club
- `set-password <username>` for a forgotten password (there's no email reset)
- `create-club "Name"` and `add-organizer <club-id> <username>` make an approved club or organizer directly (the password is asked for, not shown); `remove-organizer <username>`

To remove the stack: `aws cloudformation delete-stack --stack-name mbq-checkin --profile personal --region ap-southeast-1`. The club table and the user pool are kept (so club data and accounts survive); delete them in the AWS console if you really want them gone.

Without these settings the Phone check-in button and Club account card are hidden. For local testing, `pnpm checkin:dev` runs the same API in memory on port 5181, with a stand-in for Cognito and a dev account `demo` / `demo1234`, organizer of Dev Club (join code `DEVCLB`), used by `pnpm dev` through `.env.development`. Approve a test club there with `curl -X POST localhost:5181/dev-approve-club -d '{"username":"..."}'`. If the app moves off timgarciaa.github.io, update `AllowOrigin` in `server/template.yaml` and deploy again.

### On an iPad

Open https://timgarciaa.github.io/my-badminton-queue/ in Safari, tap Share → Add to Home Screen, and always launch it from the home-screen icon (it keeps its own data, separate from Safari). For a quick local test instead, run `pnpm dev --host` and open the Network URL on the iPad (same Wi-Fi).

## Stack

Vite, React 19, TypeScript, Tailwind CSS v4, Zustand (persist), vite-plugin-pwa, Vitest.
