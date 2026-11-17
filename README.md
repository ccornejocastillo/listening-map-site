# listening-map-site

Frontend for [Listening map](https://ccornejocastillo.github.io/listening-map-site/), served by GitHub Pages. The page is in English.

This repo is the frontend only. The backend (Python, workflows, the raw listening history) lives in the private `listening-map` repo; the only things it sends here are `data/data.json` and `data/network.json`.

```
index.html            the page structure: sections, legend, footer
assets/css/main.css   styles
assets/js/main.js     fetches data/data.json and data/network.json and fills the page (vanilla JS, no build step)
assets/js/network.js  TasteNetwork, an internal library that draws the taste network; loaded before main.js
data/data.json        written by the backend; don't edit it by hand
data/network.json     the taste network, written by the backend; don't edit it by hand
.nojekyll             tells Pages to serve the files as-is, without Jekyll
```

## Who edits what

- `index.html` and everything in `assets/` are edited here by hand.
- `data/data.json` and `data/network.json` are written by the backend's `pipeline.yml`, once a day at 03:23 UTC (00:23 in Santiago), as `github-actions[bot]`, so any hand edit is overwritten on the next run. If the backend's network step fails, `network.json` just keeps its previous version. Since the bot commits to `main` every day, run `git pull` before committing here.
- Both files are public and hold aggregates only, never individual plays or play counts.

## Data contract

The schema of `data/data.json` is documented in the backend's `docs/design.md` ("The `data.json` contract"). Its `version` goes up when the backend adds keys; the current one is 9. The two repos deploy separately, so the frontend must tolerate keys that don't exist yet: every section stays hidden until its data is there.

| Section | Keys it reads |
| --- | --- |
| Header: dates and the three numbers (totals big, last 7 days below) | `window`, `totals`, `stats` |
| This week | `summary` |
| Last 7 weeks (branch graph) | `graph` |
| Your recommendation, and "Also in this playlist" for the extras | `recommendations` (`slot` `main`/`optional` as cards, `extra` as the list) |
| Listen to this batch | `playlist_id` |
| What stuck | `stuck` |
| Footer | `generated_at`, `pending`, `next_batch` |

`data/network.json` is a separate file with its own `version` (now 1), documented in the backend's `docs/design.md` ("Taste network"). It's fetched on its own; if it's missing or fails, the "Taste network" section stays hidden and the rest of the page isn't affected.

| Section | Keys it reads |
| --- | --- |
| Taste network | `nodes` (`kind` `yours`/`rec`, `weight`, `favorite`, `status`, `played`, `x`, `y` from 0 to 1) and `edges` (`kind` `together`/`anchor`/`similar`, `weight`) |

Timestamps come as UTC ISO strings and are formatted in `America/Santiago`. Plain dates (`created`, `next_batch`, graph dates) are `YYYY-MM-DD` and are formatted as calendar days, without a time zone shift.

## How `main.js` works

1. Fetches `data/data.json` with `cache: "no-cache"`. If it fails, the page shows "Couldn't load data." instead of an empty page.
2. Fills the header and the footer, then shows each section that has data.
3. Builds every element with `textContent`, never `innerHTML`: summaries and reasons are written by Gemini and must never be able to inject markup. The network's names go into the SVG the same way.
4. Separately, fetches `data/network.json` and, if it's there, hands it to `TasteNetwork.mount` (`assets/js/network.js`). A failure there only hides the "Taste network" section.

Main pieces:

- `card(rec)`: a recommendation. The label is `also` (optional slot), `second look` if it's one, the type and the anchor. A path's artists read as a journey, "Mudhoney, then Dinosaur Jr." (`stepNames`), never with an arrow, which looked like "artist → song".
- `embed(kind, id, height)`: a Spotify embed (`artist` or `playlist`) with the dark theme. Heights: main 352 px, optional and each step of a path 152 px, playlist 352 px. Visitors without a Spotify session only hear previews.
- `drawGraph(graph, container)`: the branch graph, drawn as SVG at the container's real width (so its text stays readable on phones) and redrawn on resize. `strandRuns` turns the weekly tops into strands, and `assignLanes` places strands and branches in lanes, counting their labels' width.
- `extraItem(rec)`: a playlist extra in "Also in this playlist": name linked to Spotify, type and anchor, reason. No player of its own; its tracks are in the batch playlist.
- `stuckItem(s)`: an entry in "What stuck", marked "via playlist" for an extra.

## Taste network (`assets/js/network.js`)

`TasteNetwork` is an internal library: no dependencies, nothing global but `window.TasteNetwork`, and it doesn't know about the rest of the page. `main.js` loads `data/network.json` and calls it.

- `TasteNetwork.draw(net, container, options)`: draws once, as SVG at the container's real width (taller than wide on phones).
- `TasteNetwork.mount(net, container, options)`: draws, and redraws when the container's width changes. This is what `main.js` uses.
- `options` (all optional): `colors` (`text`, `secondary`, `accent`, `bg`, `path`), `star`, `starColor`. `main.js` passes its own `COLORS`, `STAR` and `STAR_COLOR`, so both drawings share them; without options it uses the same values as defaults.

How it draws:

- Positions come from the backend (`x` and `y` from 0 to 1) and are kept from one day to the next, so the network doesn't move between visits. The library never lays it out itself.
- Lines first: `together` in gray (thicker at weight 2), `similar` dotted in sand, `anchor` in blue, dashed toward a recommendation not played yet and gray toward a paused one.
- Then dots: your artists in three grays by weight, recommendations in blue (filled when played, ringed when merged, dashed when not played).
- Then labels by importance (`rank`): your heaviest artists, then merged and played recommendations. A label goes below its dot, else above it, else it's left out; every dot keeps its name in a tooltip. Below 560 px, only heavier artists and played recommendations get a label.

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

Colors are CSS variables in `:root` (`assets/css/main.css`) and the graph uses the same values in `COLORS` (`assets/js/main.js`), which it also passes to `TasteNetwork`; change both together. The network's own grays (`YOURS_FILL`, `TOGETHER`, `PAUSED`) live in `assets/js/network.js`.

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

## Local preview

```
git pull
python -m http.server 8000
```

Then open http://127.0.0.1:8000. Opening `index.html` directly from disk doesn't work, because the browser blocks `fetch` on `file://`. The `data/data.json` from `git pull` is the live one; to try other cases (a pending batch, a path, a full graph), edit it locally and don't commit it.

## Deploy

Pages serves `main` from the root. A push here, or the bot's daily `data/data.json` commit, is live in about a minute. Spotify caches its embeds separately: after a batch replaces the playlist, the playlist embed can show the old tracks for a while.
