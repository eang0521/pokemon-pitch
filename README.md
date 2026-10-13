# Pokémon Pitch

A static, browser-only 7-a-side soccer simulation where every player is a Pokémon card. It's a sibling of Pokémon Gridiron (the football sim) and shares its architecture and look: vanilla ES modules, no build step, no backend, hosted on GitHub Pages.

> **Status: milestone 3 of 6.** Cards, the match engine, and the match screen (pitch, controls, play-by-play, stats, replays) are done. Coach AI, fatigue and subs, and type synergies are next. The 8 regional teams are provisional (auto-built from each region's Pokédex) until milestone 5.

## Cards
Every card is a **Pokémon at a position**: Lucario GK and Lucario FWD are different cards. All 1,025 Pokémon can play all 4 positions. A card's ratings come from the Pokémon's six base stats, and each stat means something different at each position:

| Position | HP | Attack | Defense | Sp. Atk | Sp. Def | Speed |
|---|---|---|---|---|---|---|
| GK | Stamina | Distribution | Handling | Positioning | Composure | Reflexes |
| DEF | Stamina | Tackling | Strength | Passing | Awareness | Pace |
| MID | Stamina | Shot Power | Ball Retention | Passing & Vision | First Touch | Pace |
| FWD | Stamina | Shot Power | Hold-up Play | Finishing | Movement | Pace |

- **Ratings.** Each base stat becomes a 20–99 rating with the same curve as the football sim: `35 + (stat − 40) × 0.55`, soft-capped above 140.
- **Untrained traits.** Anything a position doesn't train still comes from the matching stat at **85%** (a defender who shoots uses Sp. Atk as Finishing at 85%).
- **Body.** Mass comes from weight (duels, turning), reach from height (headers, how much goal a keeper covers), and agility from Speed plus lightness.
- **OVR** is a weighted average of the traits that matter at the position (`OVR_WEIGHTS` in `js/ratings.js`). No single stat carries more than 30% of any position's OVR.

The **Cards** screen explains every stat at every position, shows how OVR is weighted, and lets you look up any Pokémon at all four positions.

## Rosters
- **Starters (7):** GK, DEF, DEF, MID, MID, FWD, FLEX. The FLEX (DEF, MID or FWD) sets the formation: DEF → **3-2-1**, MID → **2-3-1**, FWD → **2-2-2**.
- **Bench (6):** one backup each at GK, DEF, MID and FWD, plus two more outfield subs. That's 13 cards, with no Pokémon twice.

Roster values use pokemondb.net slugs; multi-position slots (FLEX, SUB1, SUB2) take `slug:POS`, for example `arcanine:FWD`.

## Watching a match
Pick a home and an away team and kick off, or open a link like `?home=kanto&away=johto&seed=42` (the same seed always plays the same match).

- **The pitch** is drawn on a canvas with the Pokémon as sprites, team-coloured bases (keepers in their own kit, and the away side switches colours on a clash), and the ball with its shadow so you can see how high it is. On a portrait phone the pitch turns vertical to fill the screen.
- **Camera:** follows the ball like a broadcast, or shows the full pitch (button, or press C).
- **Controls:** play/pause (Space, or tap the pitch on a phone), speed ½×–4× (1× runs three seconds of match time per real second, so a match takes about 7 minutes), Sim to half, Sim to end, full screen (F).
- **Replays and highlights:** every shot, goal and card in the play-by-play has a ▶ to watch it again. **Highlights** plays every goal, red card, woodwork and big save so far, and the final whistle offers the reel.
- **Tabs:** play-by-play (optionally every pass), stats (possession, shots, on target, xG, passes and completion, tackles, interceptions, saves, corners, fouls, cards, plus a player table), and lineups. Tap or hover a player on the pitch for their card.
- The match runs in a Web Worker, so the page stays smooth even during a sim; if workers aren't available it runs on the page.

## The match engine
A match is two 10-minute halves on a 60 × 40 m pitch with 5 × 2 m goals and 9 m-deep penalty areas (no offside yet). It runs at a fixed 0.05 s step and is reproducible from (home, away, seed).

- **Players** are agents with position and velocity. Top speed comes from Pace, acceleration and turning from agility (Speed plus lightness), and body mass settles collisions. Players slow down with the ball at their feet.
- **The ball** has full 3D state with no spin: rolling friction, air drag, gravity and bounces, posts and crossbar, and out of play for throw-ins, goal kicks and corners. Everyone reads the ball with the same physics it moves by, so they run to where it will be.
- **On the ball**, players weigh every option by expected value: passes to feet, through balls, long balls and crosses (each scored by interception risk along its path, the receiver's run, accuracy and the space it finds), dribbles in eight directions (tackle risk from nearby defenders), shots (expected goals, block risk), and clearances. Vision sets how noisy that judgment is. Passing, finishing, power, composure and first touch set the execution.
- **Off the ball**, the team in possession pushes up and spreads, forwards make runs in behind, and midfielders offer short options in open lanes. Defenders hold a line that stays goal-side of the ball. The nearest player presses by running to cut off the carrier, a second steps in near goal (or anywhere, for high-pressing teams), and the rest mark the most dangerous attackers goal-side.
- **Duels**: tackles (Tackling and mass vs Ball Retention and agility; harder from behind, easier square-on), blocks when a defender is next to a pass or shot, fouls, yellow and red cards, free kicks and penalties.
- **Keepers** position on the line from ball to goal and come out to narrow the angle. On a shot they react (Reflexes), then move and dive, with reach from height and a dive that stretches over time. Handling decides catch or parry, and a parry can be tipped behind for a corner. They also claim crosses (Composure) and distribute by hand or foot.
- **Every event is logged** for the play-by-play: passes, shots, saves, tackles, interceptions, fouls, cards, set pieces and goals. The match also keeps team and player stats (possession, shots, on target, xG, passes and completion, tackles, saves, fouls, cards, corners).

Tuning constants live in `TUNE` in `js/sim/matchSim.js`. The xG model is fitted to the sim's own shots with `tools/xg-fit.mjs`. Current league averages (60 matches, `node tools/sim-test.mjs 60`):

| | per match |
|---|---|
| Goals | 6.7 (xG 5.4) |
| Shots / on target | 39 / 55% |
| Save % | 71% |
| Passes / completion | 199 / 80% |
| Fouls / yellow / red | 11 / 1.9 / 0.2 |
| Penalties | 0.4 (76% scored) |
| Corners | 4.8 |
| Home / draw / away | 37% / 13% / 50% |

## Project layout

```
index.html            page shell
css/style.css         styles (shared look with the football sim)
js/main.js            UI controller: matchup picker, match playback, scorebug, panels, replays
js/render.js          pitch canvas + sprite tokens, camera
js/client.js          page-side match mirror + Web Worker connection
js/worker.js          Web Worker that runs the engine
js/engine.js          engine host: packs records into compact messages
js/guide.js           card guide: stat explainer + card browser
js/ui.js              shared UI helpers (escaping, type chips, sprites)
js/match.js           match: clock, halves, score, restarts, stats, play-by-play, frame records
js/sim/matchSim.js    the agent simulation (decisions, movement, duels, keepers, set pieces)
js/sim/ball.js        ball physics, prediction, kick planning
js/sim/pitch.js       pitch geometry
js/depth.js           a team in a match: cards, slots on the pitch, energy
js/data/teams.js      the 8 regional AI teams (generated by tools/build-teams.mjs for now)
js/data/coaches.js    coach tendency presets
js/ratings.js         cards: base stats -> position traits, OVR
js/roster.js          roster slots, FLEX formation, validation
js/storage.js         custom teams + settings in localStorage
js/modal.js           dialogs
js/rng.js             seeded RNG (mulberry32)
js/data/pokemon.js    all 1,025 Pokémon, generated (do not edit by hand)
tools/                data scraper, local server, headless tools
```

## Run locally

Plain ES modules, no build step. Any static server works:

```bash
node tools/serve.mjs 8090
```

Then open http://localhost:8090.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, then pick `main` and `/ (root)`.
3. The site will be at `https://<user>.github.io/<repo>/`.

## Tools

```bash
node tools/sim-test.mjs 60        # 60 headless matches -> league averages, pass/shot breakdowns
node tools/sim-test.mjs 8 0       # ...plus the play-by-play of match #0
node tools/trace-match.mjs 1 0 40 kanto johto 10   # seed, from/to seconds, teams, ticks per line
node tools/xg-fit.mjs 50          # fit the xG model to the sim's shots
node tools/random-rosters.mjs 30  # random teams from the whole Pokédex: crashes, extremes, upsets
node tools/build-teams.mjs        # regenerate the provisional regional teams
node tools/ratings-report.mjs 8   # OVR spread per position, stat weights, top cards
node tools/fetch-pokemon.mjs      # refresh the card database from pokemondb.net
```

Sprites are hotlinked from [pokemondb.net](https://pokemondb.net/sprites). Pokémon © Nintendo / Game Freak / The Pokémon Company. This is an unaffiliated fan project.
