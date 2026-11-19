// BranchGraph: draws "Last 7 weeks" (data.json's `graph`) as SVG, with D3. An internal module like network.js:
// main.js imports it and calls it.
//
//   BranchGraph.mount(graph, container)  draws, and redraws when the container's width changes
//
// What it shows: the band is your listening, as thick as how much you listened each week (a time scale and axis,
// d3-scale and d3-axis, the band a d3-shape area). Each line sits on its own lane, from the week it started: your
// top artists in gray (thicker when heavier) and the recommendations you've played in blue, solid while in your top
// and dotted when you only tried them. Lines don't drop from the band, so the drawing doesn't fan out toward today:
// only the band speaks of how much you listened. Faint lines mark where each week starts.
// data.json only carries weights from 0 to 3, never play counts.
//
// Interaction: hovering (or tapping) a line lights it up, dims the rest and shows what it is; hovering (or tapping)
// a week shades it and lights up the artists in your top that week. Tapping the background clears it.
import { select } from "d3-selection";
import { scaleUtc } from "d3-scale";
import { axisBottom } from "d3-axis";
import { area } from "d3-shape";
import { utcDay } from "d3-time";
import { COLORS, STAR, STAR_COLOR } from "./theme.js";

const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const toDate = s => new Date(s + "T12:00:00Z");
const REC_IN_TOP_W = 4;  // a recommendation in your top: solid and thick, unlike the dotted ones you only tried
const BAND = [1, 4, 7, 10];  // half the band's thickness, by week weight
const WEEK_LABELS = ["no plays tracked", "a lighter week", "a usual week", "a heavier week"];
const STRAND = { 1: { width: 1.5, color: "#575757" }, 2: { width: 3, color: "#6E6E6E" }, 3: { width: 5, color: "#8A8A8A" } };
const GUIDE = "#262626";  // the week lines, the same gray as the page's borders
const LEFT = 8, RIGHT = 20, LANE_H = 26, FIRST_LANE = 30, LABEL_ROOM = 18, AXIS_H = 22;
const LEAD = 14;  // a line starts this far into its week, so its label sits right on it
const MIN_SPAN = 28;
const NARROW = 480;  // below this width, every other week on the axis
const DIM = 0.14;  // opacity of what's not in focus
const TIP_LINE = 17;

// A label goes to the right of where its line starts; only when it wouldn't fit there, to the left
const CHAR_W = 6.7;  // IBM Plex Mono at 11px
const labelWidth = (text, star) => (text.length + (star ? 2 : 0)) * CHAR_W;
const nearEdge = (x0, width, textW) => x0 + 18 + textW > width - 4;

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

// Lanes on both sides of the band: an item takes the free lane closest to it, above or below, whichever is
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

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function draw(g, container) {
  container.replaceChildren();
  const width = container.clientWidth;
  const start = toDate(g.start);
  const x = scaleUtc().domain([start, utcDay.offset(start, g.weeks.length * 7)]).range([LEFT, width - RIGHT]);
  const at = d => x(toDate(d));
  const last = g.weeks.length - 1;
  const today = at(g.today);
  const weekStart = i => at(g.weeks[i].start);
  const weekEnd = i => (i === last ? today : weekStart(i + 1));
  const weekW = weekEnd(0) - weekStart(0);
  const dayW = x(utcDay.offset(start, 1)) - x(start);
  const weekOf = d => Math.floor((toDate(d) - start) / 864e5 / 7);

  // Recommendations are drawn per artist (a path's artists too), and only the ones you've played.
  // Older data.json has plain names: draw them all.
  const recs = g.branches.flatMap(b => b.artists
    .map(a => (typeof a === "string" ? { name: a, played: true } : a))
    .filter(a => a.played)
    .map(a => ({
      name: a.name, type: b.type, arrived: b.created, created: b.created < g.start ? g.start : b.created,
      end: b.end, status: b.status, last: a.last_played,
    })));
  const recByName = new Map(recs.map(r => [r.name, r]));

  // Your top artists, with their starts spread a little when several start the same week.
  // A played recommendation in your top since it arrived runs here as a blue strand instead of as a branch.
  const startsAt = {};
  const strands = strandRuns(g.weeks).map(r => {
    const k = startsAt[r.from] = (startsAt[r.from] ?? -1) + 1;
    const x0 = weekStart(r.from) + 6 + 6 * k;
    const segEnd = seg => (seg.to === last ? today : weekStart(seg.to) + weekW * 0.85);
    const x1 = Math.max(segEnd(r.segments[r.segments.length - 1]), x0 + MIN_SPAN);
    const segs = r.segments.map((seg, i) => ({
      ...seg, x0: i ? weekStart(seg.from) + 6 : x0 + LEAD, x1: i === r.segments.length - 1 ? x1 : segEnd(seg),
    }));
    const rec = recByName.get(r.artist);
    const ownRec = rec && r.to >= weekOf(rec.created) ? rec : null;
    return {
      ...r, kind: "strand", name: r.artist, x0, segs, rec: ownRec,
      // A merged recommendation keeps its lane until the day it merged, where its line ends in the ring
      x1: ownRec && ownRec.status === "merged" && ownRec.end ? Math.max(x1, at(ownRec.end)) : x1,
      text: r.favorite ? `${STAR} ${r.artist}` : r.artist,
    };
  });
  const inTop = new Set(strands.filter(s => s.rec).map(s => s.artist));

  // The other played recommendations, dotted: you tried them, they're not in your top. One you only tried a bit
  // ends where you last played it; a merged one, the day it merged. Older data.json without last_played: the end,
  // or a little past today.
  const branches = recs.filter(r => !inTop.has(r.name)).map(r => {
    const x0 = at(r.created);
    let xEnd;
    if (r.status === "merged" && r.end) xEnd = at(r.end);
    else if (r.last) xEnd = at(r.last) + dayW;
    else xEnd = r.end ? at(r.end) : today + 12;
    return { ...r, kind: "branch", rec: r, x0, x1: Math.max(xEnd, x0 + MIN_SPAN), text: r.name };
  });

  // One set of lanes on both sides of the band: branches first, so the recommendations sit closest to it
  const items = [...branches, ...strands];
  const lanes = assignLanes(items, width);
  const extent = n => (n ? FIRST_LANE + LANE_H * (n - 1) + LABEL_ROOM : 12);
  const mainY = extent(lanes.up) + 4;
  const laneY = it => mainY + it.side * (FIRST_LANE + LANE_H * it.lane);
  const height = mainY + extent(lanes.down) + AXIS_H;
  const bottom = height - AXIS_H + 2;
  for (const it of items) it.y = laneY(it);

  let focus = null;  // { item } or { week }, hovered or tapped
  const weekTop = g.weeks.map(w => new Set((w.top ?? []).map(t => t.artist)));
  const lit = it => !focus || (focus.item ? focus.item === it : weekTop[focus.week].has(it.name));

  const root = select(container).append("svg")
    .attr("width", width).attr("height", height).attr("role", "img")
    .attr("aria-label", "Your listening as a band over the last weeks, with your top artists and the recommendations you've played as lines");
  // Layers, back to front: the week lines and their hover areas; the band; the lines; the tooltip
  const back = root.append("g");
  const band = root.append("g");
  const front = root.append("g");
  const tips = root.append("g").style("pointer-events", "none");

  // Weeks: a faint line where each one starts (and at today), and an area to hover or tap it
  const shade = back.append("rect").attr("y", 0).attr("height", bottom).attr("fill", COLORS.accent).attr("opacity", 0);
  back.selectAll("line").data([...g.weeks.map((w, i) => weekStart(i)), today]).join("line")
    .attr("x1", d => d).attr("x2", d => d).attr("y1", 0).attr("y2", bottom).attr("stroke", GUIDE);
  back.selectAll("rect.week").data(g.weeks).join("rect")
    .attr("class", "week").attr("x", (w, i) => weekStart(i)).attr("width", (w, i) => weekEnd(i) - weekStart(i))
    .attr("y", 0).attr("height", bottom).attr("fill", "transparent")
    .on("pointerenter", (event, w) => { if (event.pointerType === "mouse") set({ week: g.weeks.indexOf(w) }); })
    .on("pointerleave", event => { if (event.pointerType === "mouse") set(null); })
    .on("click", (event, w) => {
      event.stopPropagation();
      const week = g.weeks.indexOf(w);
      set(focus?.week === week ? null : { week });
    });

  // The band: flat through each week at that week's thickness, with a short step into the next one
  const pts = g.weeks.flatMap((w, i) => {
    const h = BAND[w.weight ?? 0];
    return [[weekStart(i) + (i ? 6 : 0), h], [i === last ? today : weekStart(i + 1) - 6, h]];
  });
  band.append("path").attr("fill", COLORS.text)
    .attr("d", area().x(p => p[0]).y0(p => mainY + p[1]).y1(p => mainY - p[1])(pts));
  band.selectAll("circle").data(g.weeks).join("circle")
    .attr("cx", (w, i) => weekStart(i)).attr("cy", mainY)
    .attr("r", w => (w.weight ? 2.5 : 3)).attr("fill", w => (w.weight ? COLORS.bg : COLORS.text));
  band.style("pointer-events", "none");

  // The axis, one date per week (every other one on a phone)
  const axis = root.append("g").attr("class", "axis").attr("transform", `translate(0, ${height - 4})`)
    .call(axisBottom(x)
      .tickValues(g.weeks.filter((w, i) => i % (width < NARROW ? 2 : 1) === 0).map(w => toDate(w.start)))
      .tickFormat(d => shortDay.format(d)).tickSize(0).tickPadding(0));
  axis.attr("font-size", null).attr("font-family", null).select(".domain").remove();
  axis.selectAll("text").attr("fill", null).attr("dy", null);
  axis.select(".tick text").attr("text-anchor", "start");

  // Each line is a group: its paths, its ending and its label, plus a wider invisible path to hover or tap it
  const groups = front.selectAll("g").data(items).join("g").style("cursor", "pointer")
    .on("pointerenter", (event, it) => { if (event.pointerType === "mouse") set({ item: it }); })
    .on("pointerleave", event => { if (event.pointerType === "mouse") set(null); })
    .on("click", (event, it) => { event.stopPropagation(); set(focus?.item === it ? null : { item: it }); });
  groups.each(function (it) { drawItem(select(this), it); });

  function line(parent, x0, x1, y, attrs) {
    const p = parent.append("path").attr("d", `M ${x0} ${y} L ${x1} ${y}`).attr("fill", "none");
    for (const [k, v] of Object.entries(attrs)) p.attr(k, v);
    return p;
  }

  // How a recommendation ends, at the end of its own line: merged in a ring, tried in a gray dot, else open
  function ending(gr, rec, xEnd, y, open) {
    if (rec.status === "merged") gr.append("circle").attr("cx", xEnd).attr("cy", y).attr("r", 7).attr("fill", COLORS.bg).attr("stroke", COLORS.text).attr("stroke-width", 3);
    else if (rec.status === "tried") gr.append("circle").attr("cx", xEnd).attr("cy", y).attr("r", 4).attr("fill", COLORS.secondary);
    else open();
  }

  function drawItem(gr, it) {
    const y = it.y;
    if (it.kind === "strand") {
      // Solid while in your top, at that stretch's weight; a faint dotted line for the weeks it was out
      it.segs.forEach((seg, i) => {
        const style = STRAND[seg.weight];
        line(gr, seg.x0, seg.x1, y, {
          "stroke-linecap": "round", stroke: it.rec ? COLORS.accent : style.color, "stroke-width": it.rec ? REC_IN_TOP_W : style.width,
        });
        if (i) line(gr, it.segs[i - 1].x1 + 4, seg.x0 - 4, y, {
          stroke: COLORS.secondary, "stroke-width": 1, "stroke-dasharray": "1 4", "stroke-linecap": "round", "stroke-opacity": 0.6,
        });
      });
      // Merged after its last stretch in your top: a dotted blue line runs on to the ring, the day it merged
      const lastX = it.segs[it.segs.length - 1].x1;
      const mergeX = it.rec && it.rec.status === "merged" && it.rec.end ? at(it.rec.end) : null;
      if (mergeX !== null && mergeX > lastX + 8) line(gr, lastX + 4, mergeX - 8, y, {
        stroke: COLORS.accent, "stroke-width": 1.5, "stroke-dasharray": "1 4", "stroke-linecap": "round", "stroke-opacity": 0.8,
      });
      it.end = mergeX ?? lastX;
      if (it.rec) ending(gr, it.rec, it.end, y, () => gr.append("circle").attr("cx", lastX + 5).attr("cy", y).attr("r", 5).attr("fill", COLORS.accent));
    } else {
      line(gr, it.x0 + LEAD, it.x1, y, { stroke: COLORS.accent, "stroke-width": 1.5, "stroke-dasharray": "3 4" });
      it.end = it.x1;
      ending(gr, it, it.x1, y, () => gr.append("circle").attr("cx", it.x1 + 3).attr("cy", y).attr("r", 3.5)
        .attr("fill", COLORS.bg).attr("stroke", COLORS.accent).attr("stroke-width", 1.5));
    }
    const star = it.kind === "strand" && it.favorite;
    const left = nearEdge(it.x0, width, labelWidth(it.name, star));
    const text = gr.append("text").attr("class", "lbl").attr("x", left ? it.x0 - 6 : it.x0 + 18).attr("y", y - 6)
      .attr("text-anchor", left ? "end" : "start");
    if (star) text.append("tspan").style("fill", STAR_COLOR).text(`${STAR} `);
    text.append("tspan").text(it.name);
    line(gr, it.x0 + LEAD - 6, it.end + 8, y, { stroke: "transparent", "stroke-width": 16 });
  }

  // What a tooltip says about a line: what it is, when it arrived or how long it stayed, how it ended
  function itemRows(it) {
    const rows = [it.name], rec = it.rec;
    if (rec) rows.push(`${rec.type ?? "recommendation"} · recommended ${shortDay.format(toDate(rec.arrived))}`);
    if (it.kind === "strand") {
      const weeks = it.segments.reduce((n, s) => n + s.to - s.from + 1, 0);
      rows.push(`in your top ${plural(weeks, "week")}, since ${shortDay.format(toDate(g.weeks[it.from].start))}`);
    } else if (rec.last) rows.push(`last played ${shortDay.format(toDate(rec.last))}`);
    if (rec) rows.push(rec.status === "merged" && rec.end ? `merged ${shortDay.format(toDate(rec.end))}` : rec.status);
    return rows;
  }

  function tooltip(cx, anchorY, rows) {
    const w = Math.max(...rows.map(r => r.length)) * CHAR_W + 24, h = rows.length * TIP_LINE + 14;
    const tx = Math.min(Math.max(cx - w / 2, 0), width - w);
    const ty = anchorY - h - 14 < 0 ? anchorY + 14 : anchorY - h - 14;
    const box = tips.append("g").attr("transform", `translate(${tx}, ${ty})`);
    box.append("rect").attr("width", w).attr("height", h).attr("rx", 6).attr("fill", "#111111").attr("stroke", "#333333");
    rows.forEach((r, i) => box.append("text").attr("class", i ? "tip" : "tip head").attr("x", 12).attr("y", 20 + i * TIP_LINE).text(r));
  }

  function set(next) {
    focus = next;
    groups.attr("opacity", it => (lit(it) ? 1 : DIM)).classed("lit", it => Boolean(focus) && lit(it));
    shade.attr("opacity", focus?.week != null ? 0.08 : 0);
    if (focus?.week != null) shade.attr("x", weekStart(focus.week)).attr("width", weekEnd(focus.week) - weekStart(focus.week));
    tips.selectAll("*").remove();
    if (focus?.item) tooltip(focus.item.end - 40, focus.item.y, itemRows(focus.item));
    if (focus?.week != null) {
      const w = g.weeks[focus.week];
      tooltip((weekStart(focus.week) + weekEnd(focus.week)) / 2, mainY - BAND[3] - 4,
        [`Week of ${shortDay.format(toDate(w.start))}`, WEEK_LABELS[w.weight ?? 0], `${plural(weekTop[focus.week].size, "artist")} in your top`]);
    }
  }

  root.on("click", () => { if (focus) set(null); });  // tapping the background clears the focus
}

function mount(graph, container) {
  draw(graph, container);
  let lastWidth = container.clientWidth;
  window.addEventListener("resize", () => {
    if (container.clientWidth !== lastWidth) {
      lastWidth = container.clientWidth;
      draw(graph, container);
    }
  });
}

export { mount };
