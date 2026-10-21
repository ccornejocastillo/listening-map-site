# listening-map-site

Frontend for [Listening map](https://ccornejocastillo.github.io/listening-map-site/), served by GitHub Pages.

- `index.html` is the page (HTML, CSS and vanilla JS). Edit it here by hand.
- `data.json` is written daily by the backend workflow in the private `listening-map` repo. Don't edit it by hand; the next run overwrites it. It holds aggregates only.
- `.nojekyll` tells Pages to serve the files as-is.

The data contract (the schema of `data.json`) is documented in the backend's `docs/design.md`.

## Local preview

```
git pull
python -m http.server 8000
```

Then open http://127.0.0.1:8000. Opening `index.html` directly from disk doesn't work, because the browser blocks `fetch` on `file://`.
