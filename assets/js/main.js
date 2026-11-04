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

// One strand per artist: each run of consecutive weeks it spent in your top is a segment of it,
// so an artist who leaves your top and comes back keeps a single line
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
  const byArtist = new Map();
  for (const r of [...runs, ...open.values()].sort((a, b) => a.from - b.from)) {
    const s = byArtist.get(r.artist);
    if (!s) byArtist.set(r.artist, { ...r, segments: [{ from: r.from, to: r.to, weight: r.weight }] });
    else {
      s.segments.push({ from: r.from, to: r.to, weight: r.weight });
      s.to = r.to;
      s.weight = Math.max(s.weight, r.weight);
      s.favorite = s.favorite || r.favorite;
    }
  }
  return [...byArtist.values()].sort((a, b) => a.from - b.from || b.weight - a.weight);
}

// A label goes to the right of where its line starts; only when it wouldn't fit there, to the left
const CHAR_W = 6.7;  // IBM Plex Mono at 11px
const labelWidth = (text, star) => (text.length + (star ? 2 : 0)) * CHAR_W;
const nearEdge = (x0, width, textW) => x0 + 18 + textW > width - 4;

function label(root, text, x0, y, width, star = false) {
  const left = nearEdge(x0, width, labelWidth(text, star));
  const node = svg("text", { x: left ? x0 - 6 : x0 + 18, y: y - 6, "text-anchor": left ? "end" : "start" }, root);
  if (star) svg("tspan", { style: `fill: ${STAR_COLOR}` }, node).textContent = `${STAR} `;
  node.append(text);
}

// Lanes on both sides of main: an item takes the free lane closest to main, above or below, whichever is
// closer (on a tie, the side with fewer lanes, then alternating). A lane is free once its last item, label
// included, has ended. Items placed first get the inner lanes.
function assignLanes(items, width) {
  const sides = { [-1]: [], [1]: [] };
  let turn = 1;
  for (const it of items) {
    const textW = it.text.length * CHAR_W;
    const left = nearEdge(it.x0, width, textW);
    const from = left ? it.x0 - 6 - textW : it.x0;
    const to = Math.max(it.x1, left ? it.x0 : it.x0 + 18 + textW);
    const free = side => {
      const i = sides[side].findIndex(end => end + 16 < from);
      return i < 0 ? sides[side].length : i;
    };
    const up = free(-1), down = free(1);
    let side;
    if (up !== down) side = up < down ? -1 : 1;
    else if (sides[-1].length !== sides[1].length) side = sides[-1].length < sides[1].length ? -1 : 1;
    else side = turn;
    turn = -side;
    it.side = side;
    it.lane = side === -1 ? up : down;
    sides[side][it.lane] = to;
  }
  return { up: sides[-1].length, down: sides[1].length };
}

function drawGraph(g, container) {
  container.replaceChildren();
  const width = container.clientWidth;
  const left = 8, right = 20, laneH = 26, firstLane = 30, labelRoom = 18;
  const start = toDate(g.start), span = g.weeks.length * 7;
  const x = d => left + ((toDate(d) - start) / 864e5 / span) * (width - left - right);
  const weekW = x(g.weeks[1]?.start ?? g.today) - x(g.weeks[0].start);
  const minSpan = 28;
  const dayW = x(g.weeks[0].start) < x(g.today) ? (x(g.today) - x(g.start)) / ((toDate(g.today) - start) / 864e5) : 0;
  const today = x(g.today);
  const last = g.weeks.length - 1;

  // Recommendations are drawn per artist (a path's artists too), and only the ones you've played.
  // Older data.json has plain names: draw them all.
  const recs = g.branches.flatMap(b => b.artists
    .map(a => (typeof a === "string" ? { name: a, played: true } : a))
    .filter(a => a.played)
    .map(a => ({
      name: a.name, created: b.created < g.start ? g.start : b.created, end: b.end, status: b.status, last: a.last_played,
    })));
  const recByName = new Map(recs.map(r => [r.name, r]));
  const weekOf = d => Math.floor((toDate(d) - start) / 864e5 / 7);

  // Strands, with their drops off the band spread a little when several start the same week.
  // A played recommendation in your top since it arrived runs here as a blue strand instead of as a branch.
  const startsAt = {};
  const strands = strandRuns(g.weeks).map(r => {
    const k = startsAt[r.from] = (startsAt[r.from] ?? -1) + 1;
    const x0 = x(g.weeks[r.from].start) + 6 + 6 * k;
    const segEnd = seg => (seg.to === last ? today : x(g.weeks[seg.to].start) + weekW * 0.85);
    const x1 = Math.max(segEnd(r.segments[r.segments.length - 1]), x0 + minSpan);
    const segs = r.segments.map((seg, i) => ({
      ...seg, x0: i ? x(g.weeks[seg.from].start) + 6 : x0, x1: i === r.segments.length - 1 ? x1 : segEnd(seg),
    }));
    const rec = recByName.get(r.artist);
    return {
      ...r, x0, segs, rec: rec && r.to >= weekOf(rec.created) ? rec : null,
      // A merged recommendation keeps its lane until the day it merged, where its line ends in the ring
      x1: rec && rec.status === "merged" && rec.end && r.to >= weekOf(rec.created) ? Math.max(x1, x(rec.end)) : x1,
      text: r.favorite ? `${STAR} ${r.artist}` : r.artist,
    };
  });
  // The lanes are assigned after the branches are built, below
  const inTop = new Set(strands.filter(s => s.rec).map(s => s.artist));

  // The other played recommendations branch off main, dotted: you tried them, they're not in your top
  const branches = recs.filter(r => !inTop.has(r.name)).map(r => {
    const x0 = x(r.created);
    // A recommendation you only tried a bit ends where you last played it, like a strand that leaves your top;
    // a merged one rejoins main the day it merged. Older data.json without last_played: the end, or a little past today.
    let xEnd;
    if (r.status === "merged" && r.end) xEnd = x(r.end);
    else if (r.last) xEnd = x(r.last) + dayW;
    else xEnd = r.end ? x(r.end) : today + 12;
    const x1 = Math.max(xEnd, x0 + minSpan);
    return { ...r, x0, x1, text: r.name };
  });
  // One set of lanes on both sides of main: branches first, so the recommendations sit closest to it
  const lanes = assignLanes([...branches, ...strands], width);
  const extent = n => (n ? firstLane + laneH * (n - 1) + labelRoom : 12);
  const mainY = extent(lanes.up) + 4;
  const laneY = it => mainY + it.side * (firstLane + laneH * it.lane);
  const height = mainY + extent(lanes.down) + 18;
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

  // How a recommendation ends, at the end of its own line: merged in a ring, tried in a gray dot
  const ending = (rec, xEnd, y, open) => {
    if (rec.status === "merged") svg("circle", { cx: xEnd, cy: y, r: 7, fill: COLORS.bg, stroke: COLORS.text, "stroke-width": 3 }, marks);
    else if (rec.status === "tried") svg("circle", { cx: xEnd, cy: y, r: 4, fill: COLORS.secondary }, marks);
    else open();
  };

  for (const s of strands) {
    const y = laneY(s);
    // Solid while in your top, at that stretch's weight; a faint dotted line for the weeks it was out
    s.segs.forEach((seg, i) => {
      const style = STRAND[seg.weight];
      const d = i === 0
        ? `M ${seg.x0} ${mainY} C ${seg.x0} ${y}, ${seg.x0} ${y}, ${seg.x0 + 14} ${y} L ${seg.x1} ${y}`
        : `M ${seg.x0} ${y} L ${seg.x1} ${y}`;
      svg("path", {
        d, fill: "none", "stroke-linecap": "round",
        stroke: s.rec ? COLORS.accent : style.color, "stroke-width": s.rec ? REC_IN_TOP_W : style.width,
      }, lines);
      if (i) svg("path", {
        d: `M ${s.segs[i - 1].x1 + 4} ${y} L ${seg.x0 - 4} ${y}`, fill: "none", stroke: COLORS.secondary,
        "stroke-width": 1, "stroke-dasharray": "1 4", "stroke-linecap": "round", "stroke-opacity": 0.6,
      }, lines);
    });
    label(marks, s.artist, s.x0, y, width, s.favorite);
    // Merged after its last stretch in your top: a dotted blue line runs on to the ring, the day it merged
    const lastX = s.segs[s.segs.length - 1].x1;
    const mergeX = s.rec && s.rec.status === "merged" && s.rec.end ? x(s.rec.end) : null;
    if (mergeX !== null && mergeX > lastX + 8) svg("path", {
      d: `M ${lastX + 4} ${y} L ${mergeX - 8} ${y}`, fill: "none", stroke: COLORS.accent,
      "stroke-width": 1.5, "stroke-dasharray": "1 4", "stroke-linecap": "round", "stroke-opacity": 0.8,
    }, lines);
    if (s.rec) ending(s.rec, mergeX ?? lastX, y, () => svg("circle", { cx: lastX + 5, cy: y, r: 5, fill: COLORS.accent }, marks));
  }

  for (const b of branches) {
    const y = laneY(b);
    const d = `M ${b.x0} ${mainY} C ${b.x0} ${y}, ${b.x0} ${y}, ${b.x0 + 14} ${y} L ${b.x1} ${y}`;
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
    // With totals (data.json v8+), the big number is the total since the first play and the last 7 days go below;
    // without them, the last 7 days as before
    if (data.totals) {
      const since = `since ${shortDay.format(toDate(data.totals.since))}`;
      for (const key of ["tracks", "artists", "merged"]) {
        show(key, data.totals[key]);
        document.querySelector(`#${key} + .label .since`).textContent = since;
        const recent = document.getElementById(`${key}-recent`);
        recent.replaceChildren(el("b", { textContent: data.stats?.[key] ?? "—" }), " in the last 7 days");
        recent.hidden = false;
      }
    } else {
      show("tracks", data.stats?.tracks);
      show("artists", data.stats?.artists);
      show("merged", data.stats?.merged);
    }

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
