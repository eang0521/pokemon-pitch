# Pokémon Pitch

A static, browser-only 7-a-side soccer simulation where every player is a Pokémon card. It's a sibling of Pokémon Gridiron (the football sim) and shares its architecture and look: vanilla ES modules, no build step, no backend, hosted on GitHub Pages.

> **Status: milestone 1 of 6.** Card data, ratings, positions, rosters and the in-game card guide are done. The match engine is next.

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

## Project layout

```
index.html            page shell
css/style.css         styles (shared look with the football sim)
js/main.js            UI controller (screens)
js/guide.js           card guide: stat explainer + card browser
js/ui.js              shared UI helpers (escaping, type chips, sprites)
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
node tools/ratings-report.mjs 8   # OVR spread per position, stat weights, top cards
node tools/fetch-pokemon.mjs      # refresh the card database from pokemondb.net
```

Sprites are hotlinked from [pokemondb.net](https://pokemondb.net/sprites). Pokémon © Nintendo / Game Freak / The Pokémon Company. This is an unaffiliated fan project.
