// TasteNetwork: draws the taste network (data/network.json, written by the backend) as SVG, with D3.
// An internal module: nothing global; main.js imports it and only loads the data and calls it. See the network.json
// contract in the backend's docs/design.md ("Taste network").
//
//   TasteNetwork.mount(net, container)  draws, and redraws when the container's width changes
//   TasteNetwork.sceneColor(id)         a scene's color, for legends outside the drawing
//
// Colors and the favorite star come from theme.js, shared with the branch graph.
// The data only carries weights (1 to 3) and yes/no, never play counts.
//
// Layout (d3-force): the page arranges the network itself; the backend sends no positions. Lines pull the
// artists they join (anchors hardest, then sessions, then similar sound), every artist pushes the others away and
// keeps room for its label, and a soft pull to the middle keeps loose ones in. It's computed before drawing, in a
// fixed virtual space then stretched to the drawing, and d3-force's randomness is seeded, so the same data always
// gives the same network, at any screen size.
//
// Interaction (d3-zoom): pinch, or ctrl/⌘ + scroll, zooms; dragging moves once zoomed; double-click resets.
// Zoom is "semantic": positions spread out but dots, lines and labels keep their size, and labels are placed again
// at every step, so names hidden for lack of room show up as you zoom in. Hovering (or tapping) an artist lights up
// its lines and neighbors and dims the rest.
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";
import "d3-transition";  // for the animated reset: adds .transition() to selections
import { COLORS, STAR, STAR_COLOR } from "./theme.js";

const NODE_R = { 1: 4, 2: 7, 3: 11 };  // by weight, the same for every node
const YOURS_FILL = { 1: "#8A8A8A", 2: "#BDBDBD", 3: "#F2F2F2" };  // artists outside a scene
// Scenes by id (s1, s2...), muted so they don't fight the blue of recommendations; a scene keeps its id, so its
// color never jumps
const SCENE_COLORS = ["#A48BE0", "#5FC3B4", "#E08A5E", "#A9C26E", "#D58BA8", "#CDB45A"];
const TOGETHER = { 1: { stroke: "#333333", width: 1 }, 2: { stroke: "#4A4A4A", width: 2 } };
const LABEL_W = 6.4;  // IBM Plex Sans at 11px, per character
const LABEL_H = 13;
const NARROW = 560;  // below this width, fewer labels and a taller drawing
const PAD = 16;
const EDGE_ORDER = { together: 0, similar: 1, anchor: 2 };  // drawn bottom to top
const ARC = 0.18;  // how far a similar arc bends, as a share of its length
const MAX_ZOOM = 4;
const DIM_LINE = 0.12, DIM_DOT = 0.25, DIM_LABEL = 0.3;  // opacity of what's not around the artist in focus
// The layout's virtual space, and its forces
const SPACE_W = 1000, SPACE_H = 680;
const LINK = {  // distance and pull of each kind of line; similar pulls hardest, so scenes stay together
  anchor: { distance: 60, strength: 0.5 },
  together: { distance: 90, strength: 0.15 },
  similar: { distance: 70, strength: 0.35 },
};
const REPEL = -160;  // every artist pushes the others away...
const REPEL_MAX = 300;  // ...up to this distance
const ROOM = 18;  // extra room around each dot, for its label
const GRAVITY = 0.05;  // the pull to the middle...
const GRAVITY_LOOSE = 0.2;  // ...stronger for artists with no lines, so they stay near instead of drifting to the edges
const TICKS = 600;
const COOLING = 0.012;  // slower than d3's default, so it has time to untangle

function sceneColor(id) {
  const n = parseInt(String(id).slice(1), 10) || 1;
  return SCENE_COLORS[(n - 1) % SCENE_COLORS.length];
}

// Which labels go first when space is short: heaviest first, your artists before recommendations of the same weight
function rank(n) {
  return (3 - n.weight) * 2 + (n.kind === "rec" ? 1 : 0);
}

function edgeStyle(e) {
  if (e.kind === "together") {
    const s = TOGETHER[e.weight] ?? TOGETHER[1];
    return { stroke: s.stroke, "stroke-width": s.width };
  }
  if (e.kind === "similar") {
    return { stroke: COLORS.path, "stroke-width": e.weight === 2 ? 2 : 1.5, "stroke-dasharray": "1 4", "stroke-linecap": "round" };
  }
  return { stroke: COLORS.accent, "stroke-width": 1.5 };  // anchor
}

// Your artists in their scene's color (grays outside one); recommendations in their scene's color with a blue
// ring, or all blue outside one. A merged recommendation comes as one of your artists
function dotStyle(n) {
  if (n.kind === "yours") return { fill: n.scene ? sceneColor(n.scene) : YOURS_FILL[n.weight] };
  return n.scene ? { fill: sceneColor(n.scene), stroke: COLORS.accent, "stroke-width": 2 } : { fill: COLORS.accent };
}

const setAttrs = (sel, attrs) => Object.entries(attrs).forEach(([k, v]) => sel.attr(k, v));

// Draws once, at the container's current width
function draw(net, container) {
  container.replaceChildren();
  const width = container.clientWidth;
  const narrow = width < NARROW;
  const height = Math.round(narrow ? width * 1.2 : Math.max(420, width * 0.68));
  const byId = new Map(net.nodes.map(n => [n.id, n]));
  const sceneName = new Map((net.scenes ?? []).map(s => [s.id, s.name]));
  const edges = net.edges.filter(e => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) => EDGE_ORDER[a.kind] - EDGE_ORDER[b.kind]);
  const nodes = [...net.nodes].sort((a, b) => rank(a) - rank(b));
  const neighbors = new Map(nodes.map(n => [n.id, new Set([n.id])]));
  for (const e of edges) {
    neighbors.get(e.source).add(e.target);
    neighbors.get(e.target).add(e.source);
  }

  let transform = zoomIdentity;
  let focus = null;  // the artist hovered or tapped, if any
  const near = id => !focus || neighbors.get(focus).has(id);

  const at = layout(nodes, edges);
  // Positions on screen: the layout (0–1) stretched to the drawing, then through the zoom
  const X = n => transform.applyX(PAD + at.get(n.id).x * (width - 2 * PAD));
  const Y = n => transform.applyY(PAD + at.get(n.id).y * (height - 2 * PAD));

  const root = select(container).append("svg")
    .attr("width", width).attr("height", height).attr("role", "img")
    .attr("aria-label", "Your top artists and recent recommendations, colored by scene, joined by sessions, anchors and similar sound");
  const lines = root.append("g"), dots = root.append("g"), labels = root.append("g");

  function edgePath(e) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (e.kind !== "similar") return `M${X(a)},${Y(a)} L${X(b)},${Y(b)}`;
    // An arc, so it never lies on a straight line (a session or an anchor joining the same pair, or one passing by).
    // The pair goes in a fixed order, so it always bends the same way
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const x1 = X(p), y1 = Y(p), x2 = X(q), y2 = Y(q);
    const cx = (x1 + x2) / 2 - (y2 - y1) * ARC, cy = (y1 + y2) / 2 + (x2 - x1) * ARC;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }

  // Labels by rank (the artist in focus and its neighbors first): below the dot, else above it; left out when both
  // would overlap a label already placed (the name is still in the dot's tooltip)
  function placeLabels() {
    const placed = [], out = [];
    const overlaps = box => placed.some(b => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1);
    const order = focus ? [...nodes].sort((a, b) => near(b.id) - near(a.id)) : nodes;
    for (const n of order) {
      if (narrow && n.kind === "yours" && n.weight === 1 && transform.k < 1.5 && !(focus && near(n.id))) continue;
      const x = X(n), y = Y(n), r = NODE_R[n.weight];
      if (x < -40 || x > width + 40 || y < -20 || y > height + 20) continue;  // zoomed out of view
      const w = ((n.favorite ? 2 : 0) + n.name.length) * LABEL_W;
      // A label near a side is shifted in, and one near the bottom or top goes on the other side of its dot, so it's never cut
      const lx = Math.min(Math.max(x, w / 2 + 2), width - w / 2 - 2);
      const boxAtX = t => ({ x0: lx - w / 2 - 2, x1: lx + w / 2 + 2, y0: t, y1: t + LABEL_H });
      const top = [y + r + 3, y - r - 16].find(t => t >= 0 && t + LABEL_H <= height && !overlaps(boxAtX(t)));
      if (top === undefined) continue;
      placed.push(boxAtX(top));
      out.push({ n, x: lx, y: top + 10 });
    }
    return out;
  }

  function render() {
    // Drawn past its edges at rest, so labels near them aren't cut; clipped once zoomed, so nothing spills out
    root.style("overflow", transform.k === 1 && transform.x === 0 && transform.y === 0 ? "visible" : "hidden");

    lines.selectAll("path").data(edges)
      .join(enter => enter.append("path").attr("fill", "none").each(function (e) { setAttrs(select(this), edgeStyle(e)); }))
      .attr("d", edgePath)
      .attr("opacity", e => !focus || e.source === focus || e.target === focus ? 1 : DIM_LINE);

    dots.selectAll("circle").data(nodes, n => n.id)
      .join(enter => enter.append("circle")
        .attr("r", n => NODE_R[n.weight])
        .style("cursor", "pointer")
        .each(function (n) {
          setAttrs(select(this), dotStyle(n));
          const what = n.kind === "yours" ? "your artist" : "recommendation";
          const scene = sceneName.get(n.scene);
          select(this).append("title").text(`${n.favorite ? `${STAR} ` : ""}${n.name} · ${what}${scene ? ` · ${scene}` : ""}`);
        })
        .on("pointerenter", (event, n) => { if (event.pointerType === "mouse") { focus = n.id; render(); } })
        .on("pointerleave", event => { if (event.pointerType === "mouse") { focus = null; render(); } })
        .on("click", (event, n) => { event.stopPropagation(); focus = focus === n.id ? null : n.id; render(); }))
      .attr("cx", X).attr("cy", Y)
      .attr("opacity", n => near(n.id) ? 1 : DIM_DOT);

    labels.selectAll("text").data(placeLabels(), d => d.n.id)
      .join(enter => enter.append("text")
        .attr("text-anchor", "middle")
        .attr("class", d => `net-label ${d.n.kind}`)
        .each(function (d) {
          const text = select(this);
          if (d.n.favorite) text.append("tspan").style("fill", STAR_COLOR).text(`${STAR} `);
          text.append("tspan").text(d.n.name);
        }))
      .attr("x", d => d.x).attr("y", d => d.y)
      .attr("opacity", d => near(d.n.id) ? 1 : DIM_LABEL);
  }

  // Zoom: only on a pinch or ctrl/⌘ + scroll, so the page still scrolls over the drawing; one finger moves the drawing
  // only once it's zoomed in. Dragging can't take it out of its frame
  const behavior = zoom()
    .scaleExtent([1, MAX_ZOOM])
    .extent([[0, 0], [width, height]])
    .translateExtent([[0, 0], [width, height]])
    .filter(event => {
      if (event.type === "wheel") return event.ctrlKey || event.metaKey;
      if (event.type.startsWith("touch")) return event.touches.length > 1 || transform.k > 1;
      return !event.button && event.type !== "dblclick";
    })
    .on("zoom", event => { transform = event.transform; render(); });
  root.call(behavior)
    .style("touch-action", "pan-y")  // d3-zoom sets "none"; let one finger scroll the page
    .on("dblclick", () => root.transition().duration(300).call(behavior.transform, zoomIdentity))
    .on("click", () => { if (focus) { focus = null; render(); } });  // tapping the background clears the focus

  render();
}

// The network's layout with d3-force: each artist's place, from 0 to 1 on both axes. Computed all at once (TICKS steps,
// nothing animated) in the virtual space, then scaled to fill it
function layout(nodes, edges) {
  const points = nodes.map(n => ({ id: n.id, r: NODE_R[n.weight] }));  // no x or y: d3-force places them in a spiral
  const byId = new Map(points.map(p => [p.id, p]));
  const links = edges.map(e => ({ source: byId.get(e.source), target: byId.get(e.target), kind: e.kind, weight: e.weight ?? 1 }));
  const degree = new Map();
  for (const e of edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  forceSimulation(points)
    .force("link", forceLink(links)
      .distance(l => LINK[l.kind].distance)
      .strength(l => LINK[l.kind].strength * l.weight))
    .force("repel", forceManyBody().strength(REPEL).distanceMax(REPEL_MAX))
    .force("room", forceCollide(p => p.r + ROOM))
    .force("x", forceX(SPACE_W / 2).strength(p => (degree.get(p.id) ? GRAVITY : GRAVITY_LOOSE) * SPACE_H / SPACE_W))
    .force("y", forceY(SPACE_H / 2).strength(p => degree.get(p.id) ? GRAVITY : GRAVITY_LOOSE))
    .alphaDecay(COOLING)
    .stop()
    .tick(TICKS);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return new Map(points.map(p => [p.id, { x: (p.x - x0) / (x1 - x0 || 1), y: (p.y - y0) / (y1 - y0 || 1) }]));
}

function mount(net, container) {
  draw(net, container);
  let lastWidth = container.clientWidth;
  window.addEventListener("resize", () => {
    if (container.clientWidth !== lastWidth) {
      lastWidth = container.clientWidth;
      draw(net, container);
    }
  });
}

export { mount, sceneColor };
