# Pokémon Pitch

A static, browser-only 7-a-side soccer simulation where every player is a Pokémon card. It's a sibling of Pokémon Gridiron (the football sim) and shares its architecture and look: vanilla ES modules, no build step, no backend, hosted on GitHub Pages.

> **Status: milestone 5 of 6.** Cards, the match engine and screen, coach AI, fatigue and substitutions, synergies, shootouts, the 8 regional teams, the team picker, the team builder and share codes are done. A balance pass and polish are next.

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

## Teams
Eight regional AI teams, each hand-picked from its region's Pokédex (no legendaries or mythicals) with a coach whose style suits the squad:

| Team | Coach | Style | Formation | Stars |
|---|---|---|---|---|
| Kanto Kings | Oak | Balanced | 2-3-1 | Dragonite, Charizard, Gyarados, Starmie in goal |
| Johto Jets | Elm | Long Ball | 2-2-2 | Tyranitar, Espeon, Typhlosion, Crobat in goal |
| Hoenn Hurricanes | Birch | Wing Play | 2-3-1 | Metagross, Salamence, Gardevoir, Milotic in goal |
| Sinnoh Blizzard | Rowan | Park the Bus | 3-2-1 | Garchomp, Dusknoir, Lucario, Glaceon in goal |
| Unova Volts | Juniper | High Press | 2-2-2 | Hydreigon, Volcarona, Zoroark, Chandelure in goal |
| Kalos Royals | Sycamore | Possession | 2-3-1 | Goodra, Florges, Greninja, Delphox in goal |
| Alola Tides | Kukui | Island Style | 2-2-2 | Kommo-o, Primarina, Decidueye, Salazzle in goal |
| Galar Gales | Leon | Champion Time | 2-3-1 | Dragapult, Inteleon, Hatterene, Duraludon in goal |

`node tools/league.mjs 6` plays a full home-and-away league six times over. Seven teams finish within about 25 points of each other; Alola (the weakest region) is the underdog.

## Building your own team
**＋ Build a team** opens the builder. Pick a card for each of the 13 slots from all 1,025 Pokémon. You can:
- search by name, type or Pokédex number, and sort by OVR, base stat total, height, weight or any stat (labelled with what it means at that position);
- cap the base stat total to keep legendaries out;
- choose the FLEX position (which sets the formation) and the subs' positions;
- set the team's city, name, abbreviation, colours and coach (name, preset, and all six tendencies);
- see the formation, the starting seven's average OVR and their synergies as you go;
- **Auto-fill** the empty slots with the best available cards.

Custom teams are saved in your browser (with a clear message if storage is full or blocked) and appear under **Custom teams** on the matchup screen, with an **Edit** button. **Share code** turns a team into a short code and a link. Anyone can paste the code into **Import a team code**, and opening a `?team=CODE` link imports it. Matches involving custom teams get shareable links too (`?home=~CODE&away=kanto&seed=42`), which work even for people who don't have the team saved.

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
- **Tabs:** play-by-play (optionally every pass), team stats (possession, shots, on target, xG, passes and completion, tackles, interceptions, saves, corners, fouls, cards), players (a match rating out of 10 for everyone who played, the box score, and the player of the match), and lineups (a live depth chart: who's on, everyone's energy, the bench, active synergies, and what the coach is doing). Tap or hover a player on the pitch for their card.
- **Options:** Injuries (on by default) and Knockout (a draw goes to a penalty shootout). Links carry them too: `&ko=1`, `&inj=0`.
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

Tuning constants live in `TUNE` in `js/sim/matchSim.js`. The xG model is fitted to the sim's own shots with `tools/xg-fit.mjs`. Current league averages (48 matches, `node tools/sim-test.mjs 48`):

| | per match |
|---|---|
| Goals | 5.9 (xG 5.4) |
| Shots / on target | 41 / 50% |
| Save % | 73% |
| Passes / completion | 187 / 79% |
| Fouls / yellow / red | 11 / 1.8 / 0.3 |
| Penalties | 0.4 |
| Corners | 4.2 |
| Substitutions | about 6 per team (rolling) |
| Home / draw / away | 48% / 25% / 27% |

## Fatigue and substitutions
HP is stamina. Energy drains every step, more the closer a player runs to top speed, and stamina stretches it (a keeper barely tires). Below 75% energy, ratings fade (down to 82% of normal at 45% energy). Everyone gets a little back at half time.

Substitutions are rolling, as in most small-sided football. At a stoppage, the coach swaps a tired starter for a fresher bench player when the change is worth it (effective OVR = OVR × fatigue, with a penalty for playing out of position), at most two at a time. Players recover on the bench and can come back on. Keepers only swap with keepers. A typical team makes four or five changes a match.

**Injuries** (optional) are rare: a hard tackle or foul can hurt the carrier, who plays on at 60% until the next stoppage and then has to come off. If there's nobody left on the bench, the team plays short. A red card can never be replaced.

## Coaches
Every team has a coach with six tendencies (0 to 1): **tempo** (how quickly the ball moves), **press** (how high and hard they press), **width**, **directness** (forward passes and long balls over recycling), **shooting range**, and **aggression** in the tackle (more turnovers, more fouls). Presets: Balanced, Possession, Counter-Attack, High Press, Long Ball, Park the Bus, Wing Play.

During the match coaches adjust:
- **To the score and the clock.** In the last ten minutes, a team chasing the game presses higher, speeds up, goes more direct, shoots from further out and pushes everyone up. A team protecting a lead drops deeper and slows the game down.
- **To what's working.** Coaches remember the last six minutes. If balls in behind create more shots than short passing, they go more direct (and vice versa). Crosses that cause trouble mean more width, and long shots that never go in mean working it closer. If the press keeps getting played through, they drop off.

The play-by-play notes each change of approach, and the lineups tab shows the coach's current settings.

## Type synergies
Count each type among the 7 players a team has on the pitch (dual types count for both). With **2 / 4 / 6** of a type, the synergy reaches tier I / II / III, and every Pokémon of that type gets its effect. Substitutions and red cards switch them on and off.

| Type | Synergy | Effect |
|---|---|---|
| Normal | Adaptable | No weak spots: below-average base stats are pulled up toward the Pokémon's own average |
| Fighting | Brawler | +Attack (tackling, shot power, distribution) |
| Steel | Iron | +Defense (strength, ball retention, hold-up play, handling) |
| Psychic | Vision | +Sp. Atk (passing vision, finishing, keeper positioning) |
| Fairy | Grace | +Sp. Def (first touch, awareness, movement, composure) |
| Electric | Charge | +Speed (pace) |
| Dragon | Outrage | Clutch: every rating rises in the last five minutes of a close match and in shootouts |
| Fire | Burst | Faster acceleration |
| Water | Flow | Keep speed through cuts and turns |
| Grass | Photosynthesis | A ratings boost that builds to full time, and slower tiring |
| Ice | Chill | Opponents they tackle or barge into are briefly slowed |
| Poison | Toxic | Opponents they tackle or barge into lose extra energy |
| Ground | Grounded | Win more ground duels: better tackling, harder to tackle |
| Flying | Reach | Aerial reach: more headers won, keepers reach higher |
| Bug | Swarm | Stronger tackles for each teammate close by |
| Rock | Sturdy | Not knocked off the ball |
| Ghost | Phase | Chance that tackles on them pass straight through |
| Dark | Feint | Opponents react late to their passes and shots |

Magnitudes live in `SYNERGY_VALUES` in `js/synergy.js`. `tools/synergy-calibrate.mjs` plays each team against an identical copy with one synergy forced to a tier, so every type can be tuned to about the same win-rate edge.

## Penalty shootouts
In a knockout match, a draw goes to penalties: five each, then sudden death, all at the same end. Every kick is played out by the sim. The keeper guesses a side (Composure against the taker's Composure), and the taker places it with Finishing and Composure. Takers go in order of their shooting, and the keeper takes last.

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
js/depth.js           a team in a match: cards, slots on the pitch, energy, substitutions
js/coach.js           in-game coaching: score/clock adjustments and learning what works
js/synergy.js         type synergy definitions, tiers and tuned magnitudes
js/rating.js          player match ratings
js/data/teams.js      the 8 regional AI teams
js/builder.js         team builder
js/teamcode.js        team share codes
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
node tools/fatigue-report.mjs 12  # energy at full time by position and stamina, subs, injuries
node tools/synergy-calibrate.mjs 160 all 2   # win-rate edge of every type synergy (all CPU cores)
node tools/coach-test.mjs 200     # adapting vs frozen coaches: comebacks, late shots, preset records
node tools/league.mjs 6            # full home-and-away league, 6 times over: standings, shots, xG
node tools/ratings-report.mjs 8   # OVR spread per position, stat weights, top cards
node tools/fetch-pokemon.mjs      # refresh the card database from pokemondb.net
```

Sprites are hotlinked from [pokemondb.net](https://pokemondb.net/sprites). Pokémon © Nintendo / Game Freak / The Pokémon Company. This is an unaffiliated fan project.
