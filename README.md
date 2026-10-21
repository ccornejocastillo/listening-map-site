# listening-map-site

Frontend for [Listening map](https://ccornejocastillo.github.io/listening-map-site/), served by GitHub Pages.

```
index.html            the page structure
assets/css/main.css   styles
assets/js/main.js     reads data/data.json and fills the page (vanilla JS, no build step)
data/data.json        written daily by the backend; don't edit it by hand
.nojekyll             tells Pages to serve the files as-is
```

- Edit `index.html` and everything in `assets/` here by hand.
- `data/data.json` is written by the workflows in the private `listening-map` repo, so any hand edit is overwritten on the next run. It holds aggregates only. The data contract (its schema) is documented in the backend's `docs/design.md`.

## Local preview

```
git pull
python -m http.server 8000
```

Then open http://127.0.0.1:8000. Opening `index.html` directly from disk doesn't work, because the browser blocks `fetch` on `file://`.
