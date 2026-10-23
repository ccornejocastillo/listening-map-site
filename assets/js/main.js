// data/data.json is written by the backend (listening-map); see the schema in its docs/design.md.
// Keys from later phases may be missing: every section hides itself when it has no data.
const TZ = "America/Santiago";
const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const year = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

function show(id, value) {
  document.getElementById(id).textContent = value ?? "—";
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function embed(kind, id, height) {
  return el("iframe", {
    title: `Spotify ${kind}`,
    src: `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}?utm_source=generator&theme=0`,
    height,
    allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    loading: "lazy",
  });
}

// A path's artists read as a journey ("Mudhoney, then Dinosaur Jr."), never with an arrow,
// which looked like "artist → song"
const THEN = ", then ";
const steps = names => names.join(THEN);

function stepNames(container, artists, link) {
  artists.forEach((a, i) => {
    if (i) container.append(el("span", { className: "then", textContent: THEN }));
    container.append(link ? el("a", { href: a.spotify_url, textContent: a.artist }) : a.artist);
  });
  return container;
}

function card(rec) {
  const main = rec.slot === "main";
  const path = rec.type === "path";
  const label = [main ? null : "also", rec.second_look ? "second look" : null, rec.type, rec.anchor ? `from ${rec.anchor}` : null]
    .filter(Boolean).join(" · ");
  const name = stepNames(el("h3"), rec.artists, false);
  // A path shows a compact player per step; otherwise the main one is full size and the optional one compact
  const height = main && !path ? 352 : 152;
  return el("article", { className: ["card", main ? "" : "also", path ? "path" : ""].join(" ").trim() }, [
    el("div", {}, [el("div", { className: "type", textContent: label }), name, el("p", { textContent: rec.reason })]),
    el("div", { className: "embeds" }, rec.artists.map(a => embed("artist", a.artist_id, height))),
  ]);
}

// Git-style branch graph. main is your rotation, drawn as a band as thick as how much you listened each week;
// right below it, each recommendation branches off the day it arrived; further down, your top artists run as strands.
// data.json only carries weights from 0 to 3, never play counts.
const SVG = "http://www.w3.org/2000/svg";
const COLORS = { text: "#F2F2F2", secondary: "#9A9A9A", accent: "#4D7CFF", bg: "#000000" };
const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const toDate = s => new Date(s + "T12:00:00Z");
const REC_IN_TOP_W = 4;  // a recommendation in your top: solid and thick, unlike the dotted ones you only tried
const BAND = [1, 4, 7, 10];  // half the band's thickness, by week weight
const WEEK_LABELS = ["no plays tracked", "a lighter week", "a usual week", "a heavier week"];
const STRAND = { 1: { width: 1.5, color: "#575757" }, 2: { width: 3, color: "#6E6E6E" }, 3: { width: 5, color: "#8A8A8A" } };
// Favorites (an artist with a liked song) get a star before their name: a text glyph, not an emoji
const STAR = "★";
const STAR_COLOR = "#D9D9D9";

function svg(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

// Each run of consecutive weeks an artist spent in your top is one strand
function strandRuns(weeks) {
  const runs = [], open = new Map();
  weeks.forEach((w, i) => {
    const here = new Map((w.top ?? []).map(t => [t.artist, t]));
    for (const [artist, run] of open) {
      if (!here.has(artist)) { runs.push(run); open.delete(artist); }
    }
    for (const [artist, t] of here) {
      const run = open.get(artist) ?? { artist, from: i, to: i, weight: 0, favorite: false };
      run.to = i;
      run.weight = Math.max(run.weight, t.weight);
      run.favorite = run.favorite || Boolean(t.favorite);
      open.set(artist, run);
    }
  });
  return [...runs, ...open.values()].sort((a, b) => a.from - b.from || b.weight - a.weight);
}

// Labels near the right edge go to the left of their line, so they aren't cut off
const CHAR_W = 6.7;  // IBM Plex Mono at 11px
const nearEdge = (x0, width) => x0 > width * 0.6;

function label(root, text, x0, y, width, star = false) {
  const left = nearEdge(x0, width);
  const node = svg("text", { x: left ? x0 - 6 : x0 + 18, y: y - 6, "text-anchor": left ? "end" : "start" }, root);
  if (star) svg("tspan", { style: `fill: ${STAR_COLOR}` }, node).textContent = `${STAR} `;
  node.append(text);
}

// Greedy lanes: an item takes the first lane whose last item, label included, ended before it starts
function assignLanes(items, width) {
  const lanes = [];
  for (const it of items) {
    const textW = it.text.length * CHAR_W;
    const from = nearEdge(it.x0, width) ? it.x0 - 6 - textW : it.x0;
    const to = Math.max(it.x1, nearEdge(it.x0, width) ? it.x0 : it.x0 + 18 + textW);
    let lane = lanes.findIndex(end => end + 16 < from);
    if (lane < 0) lane = lanes.push(0) - 1;
    lanes[lane] = to;
    it.lane = lane;
  }
  return lanes.length;
}

function drawGraph(g, container) {
  container.replaceChildren();
  const width = container.clientWidth;
  const left = 8, right = 20, mainY = 18, strandH = 24, laneH = 30;
  const start = toDate(g.start), span = g.weeks.length * 7;
  const x = d => left + ((toDate(d) - start) / 864e5 / span) * (width - left - right);
  const weekW = x(g.weeks[1]?.start ?? g.today) - x(g.weeks[0].start);
  const minSpan = 28;
  const today = x(g.today);
  const last = g.weeks.length - 1;

  // Recommendations are drawn per artist (a path's artists too), and only the ones you've played.
  // Older data.json has plain names: draw them all.
  const recs = g.branches.flatMap(b => b.artists
    .map(a => (typeof a === "string" ? { name: a, played: true } : a))
    .filter(a => a.played)
    .map(a => ({ name: a.name, created: b.created < g.start ? g.start : b.created, end: b.end, status: b.status })));
  const recByName = new Map(recs.map(r => [r.name, r]));
  const weekOf = d => Math.floor((toDate(d) - start) / 864e5 / 7);

  // Strands, with their drops off the band spread a little when several start the same week.
  // A played recommendation in your top since it arrived runs here as a blue strand instead of as a branch.
  const startsAt = {};
  const strands = strandRuns(g.weeks).map(r => {
    const k = startsAt[r.from] = (startsAt[r.from] ?? -1) + 1;
    const x0 = x(g.weeks[r.from].start) + 6 + 6 * k;
    const x1 = Math.max(r.to === last ? today : x(g.weeks[r.to].start) + weekW * 0.85, x0 + minSpan);
    const rec = recByName.get(r.artist);
    return {
      ...r, x0, x1, rec: rec && r.to >= weekOf(rec.created) ? rec : null,
      text: r.favorite ? `${STAR} ${r.artist}` : r.artist,
    };
  });
  const strandLanes = assignLanes(strands, width);
  const inTop = new Set(strands.filter(s => s.rec).map(s => s.artist));

  // The other played recommendations branch off main, dotted: you tried them, they're not in your top
  const branches = recs.filter(r => !inTop.has(r.name)).map(r => {
    const x0 = x(r.created);
    // Open branches end a little past today, so a branch dropping off main today doesn't run over their marker
    const x1 = Math.max(r.end ? x(r.end) : today + 12, x0 + minSpan);
    return { ...r, x0, x1, text: r.name };
  });
  const branchLanes = assignLanes(branches, width);
  const branchY = lane => mainY + 4 + laneH * (lane + 1);
  const strandTop = branchLanes ? branchY(branchLanes - 1) + 10 : mainY + 10;
  const strandY = lane => strandTop + strandH * (lane + 1);
  const height = (strandLanes ? strandY(strandLanes - 1) : strandTop) + 30;
  const root = svg("svg", {
    width, height, role: "img",
    "aria-label": "Your listening as a band, your top artists as strands below it, and the recommendations you've played",
  }, container);
  // Layers, back to front: the lines start under the band so they seem to come out of it, without tips over it;
  // the band and its week nodes; then markers and labels
  const lines = svg("g", {}, root);
  const band = svg("g", {}, root);
  const marks = svg("g", {}, root);

  // The band: flat through each week at that week's thickness, with a short step into the next one
  const pts = [];
  g.weeks.forEach((w, i) => {
    const h = BAND[w.weight ?? 0];
    const x0 = x(w.start) + (i ? 6 : 0), x1 = i === last ? today : x(g.weeks[i + 1].start) - 6;
    pts.push([x0, h], [x1, h]);
  });
  const outline = [...pts.map(([px, h]) => `${px},${mainY - h}`), ...[...pts].reverse().map(([px, h]) => `${px},${mainY + h}`)];
  svg("polygon", { points: outline.join(" "), fill: COLORS.text }, band);
  g.weeks.forEach((w, i) => {
    const empty = !w.weight;
    const node = svg("circle", { cx: x(w.start), cy: mainY, r: empty ? 3 : 2.5, fill: empty ? COLORS.text : COLORS.bg }, band);
    svg("title", {}, node).textContent = `Week of ${shortDay.format(toDate(w.start))}: ${WEEK_LABELS[w.weight ?? 0]}`;
    if (i % (width < 480 ? 2 : 1) === 0) {
      svg("text", { x: x(w.start), y: height - 2, "text-anchor": i ? "middle" : "start" }, marks).textContent = shortDay.format(toDate(w.start));
    }
  });

  // How a recommendation ends: merged rejoins main with a ring, tried ends in a gray dot
  const ending = (rec, xEnd, y, open) => {
    if (rec.status === "merged") svg("circle", { cx: x(rec.end), cy: mainY, r: 7, fill: COLORS.bg, stroke: COLORS.text, "stroke-width": 3 }, marks);
    else if (rec.status === "tried") svg("circle", { cx: xEnd, cy: y, r: 4, fill: COLORS.secondary }, marks);
    else open();
  };

  for (const s of strands) {
    const y = strandY(s.lane);
    const style = STRAND[s.weight];
    svg("path", {
      d: `M ${s.x0} ${mainY} C ${s.x0} ${y}, ${s.x0} ${y}, ${s.x0 + 14} ${y} L ${s.x1} ${y}`,
      fill: "none", "stroke-linecap": "round",
      stroke: s.rec ? COLORS.accent : style.color, "stroke-width": s.rec ? REC_IN_TOP_W : style.width,
    }, lines);
    label(marks, s.artist, s.x0, y, width, s.favorite);
    if (s.rec) ending(s.rec, s.x1, y, () => svg("circle", { cx: s.x1 + 5, cy: y, r: 5, fill: COLORS.accent }, marks));
  }

  for (const b of branches) {
    const y = branchY(b.lane);
    let d = `M ${b.x0} ${mainY} C ${b.x0} ${y}, ${b.x0} ${y}, ${b.x0 + 14} ${y} L ${b.x1} ${y}`;
    if (b.status === "merged") d += ` C ${b.x1 + 16} ${y}, ${b.x1 + 16} ${y}, ${b.x1 + 16} ${mainY}`;
    svg("path", { d, fill: "none", stroke: COLORS.accent, "stroke-width": 1.5, "stroke-dasharray": "3 4" }, lines);
    label(marks, b.name, b.x0, y, width);
    ending(b, b.x1, y, () => svg("circle", {
      cx: b.x1 + 3, cy: y, r: 3.5, fill: COLORS.bg, stroke: COLORS.accent, "stroke-width": 1.5,
    }, marks));
  }
}

// A playlist extra: compact, no player of its own (its tracks are in the batch playlist)
function extraItem(rec) {
  return el("li", {}, [
    stepNames(el("div", { className: "name" }), rec.artists, true),
    el("span", { className: "meta", textContent: [rec.type, rec.anchor ? `from ${rec.anchor}` : null].filter(Boolean).join(" · ") }),
    el("p", { textContent: rec.reason }),
  ]);
}

function stuckItem(s) {
  const when = shortDay.format(toDate(s.date));
  return el("li", {}, [
    steps(s.artists),
    el("span", {
      className: "meta",
      textContent: [s.type, s.anchor ? `from ${s.anchor}` : null, s.slot === "extra" ? "via playlist" : null, when].filter(Boolean).join(" · "),
    }),
  ]);
}

fetch("data/data.json", { cache: "no-cache" })
  .then(r => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  })
  .then(data => {
    const start = new Date(data.window.start);
    const end = new Date(data.window.end);
    const updated = new Date(data.generated_at);
    show("dates", `${day.format(start)} – ${day.format(end)}, ${year.format(end)}`);
    show("tracks", data.stats?.tracks);
    show("artists", data.stats?.artists);
    show("merged", data.stats?.merged);

    if (data.summary) {
      show("summary", data.summary);
      document.getElementById("this-week").hidden = false;
    }

    if (data.graph) {
      const container = document.getElementById("graph");
      document.getElementById("weeks").hidden = false;
      drawGraph(data.graph, container);
      let lastWidth = container.clientWidth;
      window.addEventListener("resize", () => {
        if (container.clientWidth !== lastWidth) {
          lastWidth = container.clientWidth;
          drawGraph(data.graph, container);
        }
      });
    }

    const merged = data.stuck?.merged ?? [], tried = data.stuck?.tried ?? [];
    if (merged.length || tried.length) {
      document.getElementById("merged-list").append(...(merged.length ? merged.map(stuckItem) : [el("li", { className: "meta", textContent: "Nothing yet" })]));
      document.getElementById("tried-list").append(...(tried.length ? tried.map(stuckItem) : [el("li", { className: "meta", textContent: "Nothing yet" })]));
      document.getElementById("stuck").hidden = false;
    }

    const recs = (data.recommendations ?? []).filter(r => r.slot !== "extra");
    const extras = (data.recommendations ?? []).filter(r => r.slot === "extra");
    if (recs.length) {
      document.getElementById("cards").append(...recs.map(card));
      document.getElementById("recommendation").hidden = false;
      if (extras.length) {
        document.getElementById("extras-list").append(...extras.map(extraItem));
        document.getElementById("extras").hidden = false;
      }
      if (data.playlist_id) {
        const playlist = document.getElementById("playlist");
        playlist.append(embed("playlist", data.playlist_id, 352));
        playlist.hidden = false;
      }
    }

    let footer = `Last updated ${day.format(updated)}, ${year.format(updated)}, ${time.format(updated)} (Santiago)`;
    if (data.pending) footer += " · New recommendations pending";
    else if (data.next_batch) footer += ` · Next batch ${weekday.format(new Date(data.next_batch + "T12:00:00Z"))}`;
    show("updated", footer);
  })
  .catch(() => {
    document.getElementById("error").hidden = false;
  });
