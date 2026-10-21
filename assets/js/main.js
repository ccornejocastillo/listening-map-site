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

function card(rec) {
  const main = rec.slot === "main";
  const path = rec.type === "path";
  const label = [main ? null : "also", rec.second_look ? "second look" : null, rec.type, rec.anchor ? `from ${rec.anchor}` : null]
    .filter(Boolean).join(" · ");
  const name = el("h3");
  rec.artists.forEach((a, i) => {
    if (i) name.append(el("span", { className: "arrow", textContent: " → " }));
    name.append(a.artist);
  });
  // A path shows a compact player per step; otherwise the main one is full size and the optional one compact
  const height = main && !path ? 352 : 152;
  return el("article", { className: ["card", main ? "" : "also", path ? "path" : ""].join(" ").trim() }, [
    el("div", {}, [el("div", { className: "type", textContent: label }), name, el("p", { textContent: rec.reason })]),
    el("div", { className: "embeds" }, rec.artists.map(a => embed("artist", a.artist_id, height))),
  ]);
}

// Git-style branch graph: main is your rotation, each recommendation branches off the day it arrived
const SVG = "http://www.w3.org/2000/svg";
const COLORS = { text: "#F2F2F2", secondary: "#9A9A9A", accent: "#4D7CFF", path: "#FF6A3D", bg: "#000000" };
const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const toDate = s => new Date(s + "T12:00:00Z");

function svg(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

function drawGraph(g, container) {
  container.replaceChildren();
  const width = container.clientWidth;
  const left = 8, right = 20, mainY = 16, laneH = 30;
  const start = toDate(g.start), span = g.weeks.length * 7;
  const x = d => left + ((toDate(d) - start) / 864e5 / span) * (width - left - right);
  const minSpan = 28;

  // One lane per branch, reused once the branch above it has ended
  const lanes = [];
  const placed = g.branches.map(b => {
    const x0 = x(b.created < g.start ? g.start : b.created);
    // Open branches end a little past today, so a branch dropping off main today doesn't run over their marker
    const x1 = Math.max(b.end ? x(b.end) : x(g.today) + 12, x0 + minSpan);
    let lane = lanes.findIndex(end => end + 24 < x0);
    if (lane < 0) lane = lanes.push(0) - 1;
    lanes[lane] = x1 + 18;
    return { ...b, x0, x1, y: mainY + laneH * (lane + 1) };
  });
  const height = mainY + laneH * (lanes.length + 1) + 8;
  const root = svg("svg", { width, height, role: "img", "aria-label": "Recommendations branching off your usual rotation" }, container);

  // main gets thicker after each merge
  const merges = placed.filter(b => b.status === "merged").map(b => b.x1 + 16).sort((a, b) => a - b);
  const stops = [x(g.start), ...merges, x(g.today)];
  stops.slice(0, -1).forEach((sx, i) => svg("line", {
    x1: sx, y1: mainY, x2: stops[i + 1], y2: mainY, stroke: COLORS.text, "stroke-width": Math.min(2 + 1.5 * i, 7), "stroke-linecap": "round",
  }, root));
  g.weeks.forEach((w, i) => {
    const node = svg("circle", { cx: x(w.start), cy: mainY, r: 4, fill: COLORS.text }, root);
    svg("title", {}, node).textContent = `Week of ${shortDay.format(toDate(w.start))}: ${w.plays} plays`;
    if (i % (width < 480 ? 2 : 1) === 0) {
      svg("text", { x: x(w.start), y: height - 2, "text-anchor": i ? "middle" : "start" }, root).textContent = shortDay.format(toDate(w.start));
    }
  });

  for (const b of placed) {
    const color = b.type === "path" ? COLORS.path : COLORS.accent;
    const merged = b.status === "merged";
    let d = `M ${b.x0} ${mainY} C ${b.x0} ${b.y}, ${b.x0} ${b.y}, ${b.x0 + 14} ${b.y} L ${b.x1} ${b.y}`;
    if (merged) d += ` C ${b.x1 + 16} ${b.y}, ${b.x1 + 16} ${b.y}, ${b.x1 + 16} ${mainY}`;
    svg("path", {
      d, fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": b.status === "paused" ? "4 4" : "none",
    }, root);
    // Labels of branches near the right edge go to the left of the branch, so they aren't cut off
    const nearEdge = b.x0 > width * 0.6;
    svg("text", { x: nearEdge ? b.x0 - 6 : b.x0 + 18, y: b.y - 6, "text-anchor": nearEdge ? "end" : "start" }, root)
      .textContent = b.artists.join(" → ");
    if (b.type === "path") {
      b.artists.forEach((_, i) => svg("circle", {
        cx: b.x0 + 14 + ((b.x1 - b.x0 - 14) * (i + 1)) / (b.artists.length + 1), cy: b.y, r: 3.5, fill: COLORS.path,
      }, root));
    }
    if (merged) svg("circle", { cx: b.x1 + 16, cy: mainY, r: 7, fill: COLORS.bg, stroke: COLORS.text, "stroke-width": 3 }, root);
    else if (b.status === "tried") svg("circle", { cx: b.x1, cy: b.y, r: 4, fill: COLORS.secondary }, root);
    else if (b.status === "paused") svg("circle", { cx: b.x1, cy: b.y, r: 4, fill: COLORS.bg, stroke: COLORS.secondary, "stroke-width": 1.5 }, root);
    else svg("circle", { cx: b.x1, cy: b.y, r: 5, fill: COLORS.bg, stroke: color, "stroke-width": 2 }, root);
  }
}

function stuckItem(s) {
  const when = shortDay.format(toDate(s.date));
  return el("li", {}, [
    s.artists.join(" → "),
    el("span", { className: "meta", textContent: [s.type, s.anchor ? `from ${s.anchor}` : null, when].filter(Boolean).join(" · ") }),
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

    const recs = data.recommendations ?? [];
    if (recs.length) {
      document.getElementById("cards").append(...recs.map(card));
      document.getElementById("recommendation").hidden = false;
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
