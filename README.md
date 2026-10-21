# listening-map-site

Frontend for [Listening map](https://ccornejocastillo.github.io/listening-map-site/), served by GitHub Pages. The page is in English.

This repo is the frontend only. The backend (Python, workflows, the raw listening history) lives in the private `listening-map` repo; the only thing it sends here is `data/data.json`.

```
index.html            the page structure: sections, legend, footer
assets/css/main.css   styles
assets/js/main.js     fetches data/data.json and fills the page (vanilla JS, no build step)
data/data.json        written by the backend; don't edit it by hand
.nojekyll             tells Pages to serve the files as-is, without Jekyll
```

## Who edits what

- `index.html` and everything in `assets/` are edited here by hand.
- `data/data.json` is written by the backend workflows (`track.yml` daily at 07:00 UTC, `recommend.yml` at 12:00 UTC) as `github-actions[bot]`, so any hand edit is overwritten on the next run. Since the bot commits to `main` every day, run `git pull` before committing here.
- `data/data.json` is public and holds aggregates only, never individual plays.

## Data contract

The schema of `data/data.json` is documented in the backend's `docs/design.md` ("The `data.json` contract"). Its `version` goes up when the backend adds keys; the current one is 3. The two repos deploy separately, so the frontend must tolerate keys that don't exist yet: every section stays hidden until its data is there.

| Section | Keys it reads |
| --- | --- |
| Header: dates and the three numbers | `window`, `stats` |
| This week | `summary` |
| Last 7 weeks (branch graph) | `graph` |
| Your recommendation | `recommendations` |
| Listen to this batch | `playlist_id` |
| What stuck | `stuck` |
| Footer | `generated_at`, `pending`, `next_batch` |

Timestamps come as UTC ISO strings and are formatted in `America/Santiago`. Plain dates (`created`, `next_batch`, graph dates) are `YYYY-MM-DD` and are formatted as calendar days, without a time zone shift.

## How `main.js` works

1. Fetches `data/data.json` with `cache: "no-cache"`. If it fails, the page shows "Couldn't load data." instead of an empty page.
2. Fills the header and the footer, then shows each section that has data.
3. Builds every element with `textContent`, never `innerHTML`: summaries and reasons are written by Gemini and must never be able to inject markup.

Main pieces:

- `card(rec)`: a recommendation. The label is `also` (optional slot), `second look` if it's one, the type and the anchor. A path joins its artists with an orange `→`.
- `embed(kind, id, height)`: a Spotify embed (`artist` or `playlist`) with the dark theme. Heights: main 352 px, optional and each step of a path 152 px, playlist 352 px. Visitors without a Spotify session only hear previews.
- `drawGraph(graph, container)`: the branch graph, drawn as SVG at the container's real width (so its text stays readable on phones) and redrawn on resize.
- `stuckItem(s)`: an entry in "What stuck".

## Branch graph

- `main` is your usual rotation: a white line with one node per week (hover shows that week's plays).
- Each recommendation branches off the day it arrived, in its own lane; a lane is reused once the branch above it has ended.
- **Merged:** the branch rejoins `main` with a thick ring, and `main` gets thicker after each merge.
- **Tried:** ends in a gray dot. **Paused:** dashed, ends in an open gray circle.
- **Open / second look:** ends in an open blue circle, a little past today, so a branch dropping off `main` today doesn't run over it.
- **Path:** orange, with one dot per step.
- Labels of branches near the right edge go to the left of the branch, so they aren't cut off.

## Style

Colors are CSS variables in `:root` (`assets/css/main.css`) and the graph uses the same values in `COLORS` (`assets/js/main.js`); change both together.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#000000` | Background |
| `--text` | `#F2F2F2` | Text, `main` in the graph |
| `--secondary` | `#9A9A9A` | Labels, dates, tried and paused |
| `--border` | `#262626` | Dividers |
| `--accent` | `#4D7CFF` | Recommendation labels, branches, open |
| `--path` | `#FF6A3D` | Paths |

Fonts, from Google Fonts: Space Grotesk (headings), IBM Plex Sans (body) and IBM Plex Mono (numbers and labels). Below 720 px the cards and "What stuck" stack; below 560 px the three header numbers do too.

## Local preview

```
git pull
python -m http.server 8000
```

Then open http://127.0.0.1:8000. Opening `index.html` directly from disk doesn't work, because the browser blocks `fetch` on `file://`. The `data/data.json` from `git pull` is the live one; to try other cases (a pending batch, a path, a full graph), edit it locally and don't commit it.

## Deploy

Pages serves `main` from the root. A push here, or the bot's daily `data/data.json` commit, is live in about a minute. Spotify caches its embeds separately: after a batch replaces the playlist, the playlist embed can show the old tracks for a while.
