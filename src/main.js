// data/data.json is written by the backend (listening-map); see the schema in its docs/design.md.
// The page's entry point: esbuild bundles it, with what it imports, into assets/js/main.js (see package.json).
import * as BranchGraph from "./branch.js";
import * as TasteNetwork from "./network.js";

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

const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const toDate = s => new Date(s + "T12:00:00Z");

// A playlist extra: compact, with a compact player per artist like an optional card
function extraItem(rec) {
  return el("li", {}, [
    stepNames(el("div", { className: "name" }), rec.artists, true),
    el("span", { className: "meta", textContent: [rec.type, rec.anchor ? `from ${rec.anchor}` : null].filter(Boolean).join(" · ") }),
    el("p", { textContent: rec.reason }),
    el("div", { className: "embeds" }, rec.artists.map(a => embed("artist", a.artist_id, 152))),
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
      BranchGraph.mount(data.graph, container, document.getElementById("graph-legend"));
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
    }

    let footer = `Last updated ${day.format(updated)}, ${year.format(updated)}, ${time.format(updated)} (Santiago)`;
    if (data.pending) footer += " · New recommendations pending";
    else if (data.next_batch) footer += ` · Next batch ${weekday.format(new Date(data.next_batch + "T12:00:00Z"))}`;
    show("updated", footer);
  })
  .catch(() => {
    document.getElementById("error").hidden = false;
  });

// The scenes, by name, first in the network's legend
function sceneLegend(scenes) {
  // Each scene is a filter, like the rest of the legend: hovering or tapping it lights up the scene in the network
  document.getElementById("network-legend").prepend(...scenes.map(s => {
    const key = el("button", { type: "button" }, [
      el("span", { className: "scene-dot", style: `background: ${TasteNetwork.sceneColor(s.id)}` }), s.name,
    ]);
    key.dataset.filter = `scene:${s.id}`;
    return key;
  }));
}

const pct = v => (v == null ? "—" : `${Math.round(v * 100)}%`);

// "Your scenes": the last closed week by scene, then three numbers, each with the last weeks as bars (the
// latest in white). Scores and shares only; the backend never sends counts
function scenesSection(scenes, weeks) {
  const last = weeks[weeks.length - 1];
  if (!scenes.length || !last) return;
  document.getElementById("scene-week").textContent = `Week of ${shortDay.format(toDate(last.start))}`;
  const parts = scenes.map(s => ({ name: s.name, share: last.shares?.[s.id] ?? 0, color: TasteNetwork.sceneColor(s.id) }));
  const outside = Math.max(0, 1 - last.in_scene);
  const bar = document.getElementById("scene-bar");
  bar.append(
    ...parts.filter(p => p.share > 0).map(p => el("div", { style: `flex: ${p.share}; background: ${p.color}` })),
    el("div", { className: "outside", style: `flex: ${outside}` }),
  );
  bar.setAttribute("aria-label", [...parts.map(p => `${p.name} ${pct(p.share)}`), `outside a scene ${pct(outside)}`].join(", "));
  document.getElementById("scene-keys").append(
    ...parts.map(p => el("span", {}, [el("span", { className: "scene-dot", style: `background: ${p.color}` }), `${p.name} ${pct(p.share)}`])),
    el("span", {}, [el("span", { className: "scene-dot", style: "background: #6A6A6A" }), `outside a scene ${pct(outside)}`]),
  );
  const tiles = [
    { title: "In a scene", key: "in_scene", show: pct, text: "of the week's plays are by an artist in one of your scenes. Low means playlists, loose artists or something new." },
    { title: "Spread", key: "spread", show: v => (v == null ? "—" : v.toFixed(2)), outOf: " / 1", text: "how evenly the week moved between scenes: 0 is one scene only, 1 is all of them alike." },
    { title: "One scene at a time", key: "one_scene", show: pct, text: "of the week's sessions stayed in a single scene; the rest jumped between them." },
  ];
  const span = weeks.length > 1 ? [shortDay.format(toDate(weeks[0].start)), shortDay.format(toDate(last.start))] : [];
  document.getElementById("scene-tiles").append(...tiles.map(t => {
    const value = el("span", { className: "num", textContent: t.show(last[t.key]) });
    if (t.outOf && last[t.key] != null) value.append(el("span", { className: "out-of", textContent: t.outOf }));
    const bars = el("div", { className: "bars", role: "img" }, weeks.map(w => el("span", { style: `height: ${Math.round((w[t.key] ?? 0) * 100)}%` })));
    bars.setAttribute("aria-label", `${t.title}, week by week: ${weeks.map(w => t.show(w[t.key])).join(", ")}`);
    return el("div", { className: "tile" }, [
      el("span", { className: "label", textContent: t.title }),
      value,
      el("p", { textContent: t.text }),
      bars,
      el("div", { className: "span" }, span.map(d => el("span", { textContent: d }))),
    ]);
  }));
  document.getElementById("scenes").hidden = false;
}

// The network comes in its own file, so a missing or broken network.json never affects the rest of the page:
// the section just stays hidden
fetch("data/network.json", { cache: "no-cache" })
  .then(r => (r.ok ? r.json() : null))
  .then(net => {
    if (!net?.nodes?.length) return;
    document.getElementById("network").hidden = false;
    TasteNetwork.mount(net, document.getElementById("network-graph"), document.getElementById("network-legend"));
    sceneLegend(net.scenes ?? []);
    scenesSection(net.scenes ?? [], net.weeks ?? []);
  })
  .catch(() => {});
