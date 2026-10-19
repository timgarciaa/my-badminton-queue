# MBQ — My Badminton Queue

iPad web app (PWA) for running badminton sessions: master player list, check-in, a first-come-first-served court queue with balanced doubles, shuttlecock count, and an equal cost split per head.

## Features

- **Players** — master list with gender and skill level (Beginner, Low-Int, Intermediate, High-Int, Advanced). Archive players who stop coming. **Import list** takes a pasted list (one name per line, numbering ignored); then use **Needs gender** and the inline M/F and 1–5 buttons to fill in each player.
- **Check-in** — tap a name under "Not here yet" to check them in (in arrival order); a short Undo bar catches mistakes. Tapping never checks anyone out: "Check out" is a separate, confirmed button, only for players who haven't played yet.
- **Courts** — 1–6 courts. "Next game" takes the first 4 in the queue and splits them into the two most even teams (avoiding a recent repeat partner). "Re-pair" tries another split, "Undo" sends the 4 back to the front. "End game" sends them to the back of the queue.
- **Partner rotation** — MBQ remembers every partnership in the session and prefers fresh partners, accepting a slightly less even game (up to 2 skill points) to avoid a repeat. It never makes a lopsided game just to rotate.
- **Mixed pairs** — when two splits are equally balanced on skill, MBQ prefers one male + one female per team.
- **Games & records** — when ending a game, tap the winning team. The Games tab lists every finished game (tap a team to correct the winner) and a win/loss table for this session or all time. Players also shows each player's all-time W–L.
- **Balance along the way** — if the next 4 would be a rematch (nearly the same four as an earlier game), repeat a partnership or make a lopsided game, MBQ automatically swaps one of them with the 5th or 6th player in line when you tap Next game. The queue previews the swap, the court shows who swapped in, and Undo reverses it.
- **Queue preview** — the queue shows the next game split into its two teams (teal vs amber), exactly as the next court will start it, followed by the numbered waiting list. Drag a player's ⠿ grip onto another player, or tap two players, to swap them (between teams or with someone waiting). Manual changes fix the next game's teams as shown ("Set by hand") and pause automatic swaps until that game starts; tap **Auto** to undo them.
- **Game numbers** — each game gets a number in start order, shown on the court and in the Games tab.
- **Rest** — take a player out of the queue without removing them from the session (they still pay).
- **Costs** — (court fee + shuttles used × shuttle price) ÷ players present, rounded up to the next whole peso (no centavos). Shuttles are reused, so a game starts at 0 — tap + on the court when a new shuttle is opened. Adjust the total on Costs if needed. Tap a player to mark them paid.
- **Settings** — export/import a JSON backup, discard the current session, view past sessions.

Data is stored in the browser on the device (localStorage). Export a backup regularly.

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

### On an iPad

Open https://timgarciaa.github.io/my-badminton-queue/ in Safari, tap Share → Add to Home Screen, and always launch it from the home-screen icon (it keeps its own data, separate from Safari). For a quick local test instead, run `pnpm dev --host` and open the Network URL on the iPad (same Wi-Fi).

## Stack

Vite, React 19, TypeScript, Tailwind CSS v4, Zustand (persist), vite-plugin-pwa, Vitest.
