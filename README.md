# listening-map-site

Frontend for [Listening map](https://ccornejocastillo.github.io/listening-map-site/), built with esbuild and served by GitHub Pages. The page is in English.

This repo is the frontend only. The backend (Python, workflows, the raw listening history) lives in the private `listening-map` repo; the only things it sends here are `data/data.json` and `data/network.json`.

```
index.html                    the page structure: sections, legend, footer
src/main.js                   the entry point: fetches data/data.json and data/network.json and fills the page
src/network.js                TasteNetwork, an internal module that draws the taste network; main.js imports it
src/theme.js                  the colors and favorite star both drawings share
src/main.css                  styles
assets/                       favicon and touch icon, copied as they are
data/data.json                written by the backend; don't edit it by hand
data/network.json             the taste network, written by the backend; don't edit it by hand
package.json                  the build (npm scripts) and the dependencies: D3's modules for the page, esbuild for the build
.github/workflows/deploy.yml  builds and publishes the page on every push to main
```

`dist/` (the built page) and `node_modules/` are made by the build and never committed.

## Who edits what

- `index.html`, `src/` and `assets/` are edited here by hand.
- `data/data.json` and `data/network.json` are written by the backend's `pipeline.yml`, once a day at 03:23 UTC (00:23 in Santiago), as `github-actions[bot]`, so any hand edit is overwritten on the next run. If the backend's network step fails, `network.json` just keeps its previous version. Since the bot commits to `main` every day, run `git pull` before committing here.
- Both files are public and hold aggregates only, never individual plays or play counts.

## Data contract

The schema of `data/data.json` is documented in the backend's `docs/design.md` ("The `data.json` contract"). Its `version` goes up when the backend adds keys; the current one is 9. The two repos deploy separately, so the frontend must tolerate keys that don't exist yet: every section stays hidden until its data is there.

| Section | Keys it reads |
| --- | --- |
| Header: dates and the three numbers (totals big, last 7 days below) | `window`, `totals`, `stats` |
| This week | `summary` |
| Last 7 weeks (branch graph) | `graph` |
| Your recommendation, and "Also in this playlist" for the extras | `recommendations` (`slot` `main`/`optional` as cards, `extra` as the list, each with a compact player) |
| What stuck | `stuck` |
| Footer | `generated_at`, `pending`, `next_batch` |

`data/network.json` is a separate file with its own `version` (now 1), documented in the backend's `docs/design.md` ("Taste network"). It's fetched on its own; if it's missing or fails, the "Taste network" section stays hidden and the rest of the page isn't affected.

| Section | Keys it reads |
| --- | --- |
| Taste network | `nodes` (`kind` `yours`/`rec`, `weight`, `favorite`; no positions, the page lays them out) and `edges` (`kind` `together`/`anchor`/`similar`, `weight`); `scene` on the nodes of a scene |
| Taste network legend and "Your scenes" | `scenes` (`id`, `name`) and `weeks` (`start`, `in_scene`, `spread`, `one_scene`, `shares` by scene id), shares and scores from 0 to 1 |

Timestamps come as UTC ISO strings and are formatted in `America/Santiago`. Plain dates (`created`, `next_batch`, graph dates) are `YYYY-MM-DD` and are formatted as calendar days, without a time zone shift.

## How `main.js` works

1. Fetches `data/data.json` with `cache: "no-cache"`. If it fails, the page shows "Couldn't load data." instead of an empty page.
2. Fills the header and the footer, then shows each section that has data.
3. Builds every element with `textContent`, never `innerHTML`: summaries and reasons are written by Gemini and must never be able to inject markup. The network's names go into the SVG the same way.
4. Separately, fetches `data/network.json` and, if it's there, hands it to `TasteNetwork.mount` (`src/network.js`). A failure there only hides the "Taste network" section.

Main pieces:

- `card(rec)`: a recommendation. The label is `also` (optional slot), `second look` if it's one, the type and the anchor. A path's artists read as a journey, "Mudhoney, then Dinosaur Jr." (`stepNames`), never with an arrow, which looked like "artist → song".
- `embed(kind, id, height)`: a Spotify embed (`artist`) with the dark theme. Heights: main 352 px, optional and each step of a path 152 px. Visitors without a Spotify session only hear previews.
- `drawGraph(graph, container)`: the branch graph, drawn as SVG at the container's real width (so its text stays readable on phones) and redrawn on resize. `strandRuns` turns the weekly tops into strands, and `assignLanes` places strands and branches in lanes, counting their labels' width.
- `extraItem(rec)`: a playlist extra in "Also in this playlist": name linked to Spotify, type and anchor, reason. No player of its own; its tracks are in the batch playlist.
- `stuckItem(s)`: an entry in "What stuck", marked "via playlist" for an extra.

## Taste network (`src/network.js`)

`TasteNetwork` is an internal module drawn with D3 (`d3-selection`, `d3-force`, `d3-zoom`, `d3-transition`): nothing global, and it doesn't know about the rest of the page. It exports `mount` and `sceneColor`; `main.js` imports it as `TasteNetwork` (`import * as TasteNetwork from "./network.js"`), loads `data/network.json` and calls it.

- `TasteNetwork.mount(net, container)`: draws as SVG at the container's real width (taller than wide on phones), and redraws when that width changes.
- `TasteNetwork.sceneColor(id)`: a scene's color, so `main.js` uses the same ones in the legend and in "Your scenes".
- Colors and the favorite star come from `src/theme.js` (`COLORS`, `STAR`, `STAR_COLOR`), which `main.js` imports too, so both drawings share them.

How it draws:

- The layout is the page's own (`layout()`, with `d3-force`); the backend sends no positions. Lines pull the artists they join (`LINK`: similar sound hardest, so scenes stay together, then anchors, then sessions), every artist pushes the others away (`REPEL`) and keeps room for its label (`ROOM`), and a pull to the middle keeps everyone in, harder for artists with no lines (`GRAVITY_LOOSE`), so they don't drift to the edges. It runs all at once before drawing (`TICKS` steps, nothing animated), in a fixed virtual space that's then stretched to the drawing, and d3-force's randomness is seeded, so the same data gives the same network on every visit and at any size. It can still change from one day to the next when the data does.
- Lines first: `together` in gray (thicker at weight 2), `similar` dotted in sand, as an arc that always bends the same way for a pair (so it never lies on a straight line, even where an anchor joins the same pair), `anchor` in blue.
- Then dots: your artists in their scene's color, or in three grays by weight outside a scene; recommendations in their scene's color with a blue ring, or all blue outside a scene. A merged recommendation comes as one of your artists (`kind` `yours`). One radius scale for every node, by weight (`NODE_R`). The backend only sends recommendations you've played. Scene colors (`SCENE_COLORS`) go by id, so a scene keeps its color.

- Then labels by importance (`rank`): heaviest first, your artists before recommendations of the same weight. A label goes below its dot, else above it, else it's left out; every dot keeps its name in a tooltip. Below 560 px, your lightest artists get no label.

How it reacts (the hint under the drawing says how, for mouse or touch):

- Zoom with a pinch, or ctrl/⌘ + scroll, from 1× to 4×; a plain scroll still scrolls the page, and on phones one finger moves the drawing only once it's zoomed in. Dragging moves it, never out of its frame. A double-click (or double-tap) goes back to the start, animated.
- The zoom is semantic: positions spread apart while dots, lines and labels keep their size, and labels are placed again at every step, so names left out for lack of room appear as you zoom in.
- Hovering an artist (tapping it on a phone) lights up its lines and neighbors, puts their labels first and dims the rest; tapping the background clears it.
- Everything is drawn by `render()`, which joins the data to SVG elements (`selection.data().join()`) and only moves them on zoom.

"Your scenes" (`scenesSection` in `main.js`): the last closed week as a bar by scene, then three tiles (In a scene, Spread, One scene at a time) with the last weeks as bars, the latest in white. It stays hidden without scenes or weeks.

## Branch graph

- `main` is your usual rotation: a white band, flat through each week at that week's weight (0 to 3: no plays, lighter, usual, heavier), with a node per week (hover says which). `data.json` carries weights, never play counts, so the page can't show them.
- Your top artists run below as strands: one line per artist (`strandRuns` groups its runs of consecutive weeks in the top 5 into segments), gray, each segment as thick as its weight, with a faint dotted stretch for the weeks it was out of the top. Favorites (`favorite`: the artist has a liked song) get a ★ before their name (`STAR`, a text glyph, not an emoji); the strand stays the same gray.
- Recommendations are drawn per artist (a path's artists too, each on its own) and only the ones with `played`; older `data.json` with plain names draws them all.
- **Tried a bit:** a thin dotted blue branch off `main` from the day it arrived to its `last_played` day, ending in a small open circle. Older `data.json` without `last_played`: it runs a little past today.
- **In your top:** a recommendation whose artist is in your top since it arrived is drawn as that strand, solid blue and `REC_IN_TOP_W` thick, ending in a filled dot, and not as a branch.
- **Merged:** a thick ring at the end of the recommendation's own line, the day it merged (a dotted blue line reaches it if it merged after its last week in your top). **Tried:** ends in a gray dot.
- Three layers: lines (`lines`) under the band (`band`), then markers and labels (`marks`), so lines come out from under `main` with no tips over it.
- `main` sits in the middle: `assignLanes` puts each line in the free lane closest to `main`, above or below (on a tie, the side with fewer lanes, then alternating), branches first so recommendations are nearest to it. A lane is reused once what was in it, label included, has ended.
- A label goes to the right of where its line starts; only when it wouldn't fit before the edge, to the left (`nearEdge`).

## Style

Colors are CSS variables in `:root` (`src/main.css`) and both drawings use the same values in `COLORS` (`src/theme.js`); change both together. The network's own grays (`YOURS_FILL`, `TOGETHER`) live in `src/network.js`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#000000` | Background |
| `--text` | `#F2F2F2` | Text, `main` in the graph |
| `--secondary` | `#9A9A9A` | Labels, dates, tried and paused |
| `--border` | `#262626` | Dividers |
| `--accent` | `#4D7CFF` | Recommendation labels, branches, open |
| `--path` | `#B8936E` | Path cards (a muted sand, so a path doesn't outweigh the main recommendation) and the network's similar-sound lines |

Strands use three grays by weight, `#575757`, `#6E6E6E` and `#8A8A8A` (`STRAND` in `main.js`); the band's half thickness by week weight is in `BAND`.

Fonts, from Google Fonts: Space Grotesk (headings), IBM Plex Sans (body) and IBM Plex Mono (numbers and labels). Below 720 px the cards and "What stuck" stack; below 560 px the three header numbers do too.

## Build and local preview

It needs Node.js (22, like the deploy). Once, after cloning:

```
npm install
```

Then, to work on the page:

```
git pull
npm run dev
```

and open http://127.0.0.1:8000. `npm run dev` builds into `dist/`, serves it, and rebuilds whenever a file changes (reload the page to see it). `npm run build` builds once, as the deploy does. Opening `index.html` from the repo doesn't work: it points to the built `assets/js/main.js`, which only exists in `dist/`.

What the build does (the `build` script in `package.json`, a single esbuild command):

- Bundles `src/main.js` and everything it imports into one minified `dist/assets/js/main.js`, and `src/main.css` into `dist/assets/css/main.css`, each with a sourcemap, so the browser's developer tools show the original files and lines. A dependency added with `npm install` comes in with only the parts that are imported.
- Copies `index.html`, the icons and `data/*.json` as they are (the `copy` loaders), keeping their paths.
- Targets browsers from about 2020 (`--target=es2020`).
 The `data/data.json` from `git pull` is the live one; to try other cases (a pending batch, a path, a full graph), edit it locally and don't commit it.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`, yours or the bot's daily data push, and can be run by hand: `npm ci` (exactly the versions in `package-lock.json`), `npm run build`, then it publishes `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`. The Pages source is "GitHub Actions" (Settings › Pages). A push is live in about one to two minutes; one deploy runs at a time, and a newer push waits for the running one.

To add a dependency: `npm install <package>`, import it from `src/`, and commit `package.json` and `package-lock.json` together.
