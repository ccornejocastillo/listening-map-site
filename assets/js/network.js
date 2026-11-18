// TasteNetwork: draws the taste network (data/network.json, written by the backend) as SVG.
// An internal library: no dependencies and no globals besides window.TasteNetwork, so main.js only loads the data
// and calls it. See the network.json contract in the backend's docs/design.md ("Taste network").
//
//   TasteNetwork.draw(net, container, options)   draws once, at the container's current width
//   TasteNetwork.mount(net, container, options)  draws, and redraws when the container's width changes
//
// options (all optional): colors { text, secondary, accent, bg, path }, star, starColor.
// The data only carries weights (1 to 3) and yes/no, never play counts; positions come from the backend
// (x and y from 0 to 1) and are kept from one day to the next, so the network doesn't move between visits.
(function () {
  const SVG = "http://www.w3.org/2000/svg";
  const DEFAULTS = {
    colors: { text: "#F2F2F2", secondary: "#9A9A9A", accent: "#4D7CFF", bg: "#000000", path: "#B8936E" },
    star: "★",
    starColor: "#D9D9D9",
  };
  const NODE_R = { yours: { 1: 4, 2: 7, 3: 11 }, rec: { 1: 4.5, 2: 7, 3: 10 } };
  const YOURS_FILL = { 1: "#8A8A8A", 2: "#BDBDBD", 3: "#F2F2F2" };
  const TOGETHER = { 1: { stroke: "#333333", width: 1 }, 2: { stroke: "#4A4A4A", width: 2 } };
  const LABEL_W = 6.4;  // IBM Plex Sans at 11px, per character
  const LABEL_H = 13;
  const NARROW = 560;  // below this width, fewer labels and a taller drawing
  const PAD = 16;
  const EDGE_ORDER = { together: 0, similar: 1, anchor: 2 };  // drawn bottom to top

  function svg(tag, attrs, parent) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.append(node);
    return node;
  }

  // Which labels go first when space is short: your heaviest artists, then merged recommendations, then the others
  // by weight. The network only has recommendations you've played
  function rank(n) {
    if (n.kind === "yours") return 10 - n.weight;
    if (n.status === "merged") return 5;
    return 6 + (3 - n.weight);
  }

  function edgeStyle(e, colors) {
    if (e.kind === "together") {
      const s = TOGETHER[e.weight] ?? TOGETHER[1];
      return { stroke: s.stroke, "stroke-width": s.width };
    }
    if (e.kind === "similar") {
      return { stroke: colors.path, "stroke-width": e.weight === 2 ? 2 : 1.5, "stroke-dasharray": "1 4", "stroke-linecap": "round" };
    }
    return { stroke: colors.accent, "stroke-width": 1.5 };  // anchor
  }

  function dotStyle(n, colors) {
    if (n.kind === "yours") return { fill: YOURS_FILL[n.weight] };
    if (n.status === "merged") return { fill: colors.accent, stroke: colors.text, "stroke-width": 2.5 };
    return { fill: colors.accent };
  }

  function draw(net, container, options = {}) {
    const colors = { ...DEFAULTS.colors, ...options.colors };
    const star = options.star ?? DEFAULTS.star, starColor = options.starColor ?? DEFAULTS.starColor;
    container.replaceChildren();
    const width = container.clientWidth;
    const narrow = width < NARROW;
    const height = Math.round(narrow ? width * 1.2 : Math.max(420, width * 0.68));
    const px = n => PAD + n.x * (width - 2 * PAD), py = n => PAD + n.y * (height - 2 * PAD);
    const byId = new Map(net.nodes.map(n => [n.id, n]));
    const root = svg("svg", {
      width, height, role: "img",
      "aria-label": "Your top artists and recent recommendations, joined by sessions, anchors and similar sound",
    }, container);
    const lines = svg("g", {}, root), dots = svg("g", {}, root), labels = svg("g", {}, root);

    for (const e of [...net.edges].sort((a, b) => EDGE_ORDER[a.kind] - EDGE_ORDER[b.kind])) {
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) continue;
      svg("line", { x1: px(a), y1: py(a), x2: px(b), y2: py(b), ...edgeStyle(e, colors) }, lines);
    }

    // Dots, then labels by rank: below the dot, else above it; left out when both would overlap a label
    // already placed (the name is still in the dot's tooltip)
    const placed = [];
    const overlaps = box => placed.some(b => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1);
    for (const n of [...net.nodes].sort((a, b) => rank(a) - rank(b))) {
      const r = NODE_R[n.kind][n.weight] + (n.status === "merged" ? 2 : 0);
      const x = px(n), y = py(n);
      const name = `${n.favorite ? `${star} ` : ""}${n.name}`;
      const dot = svg("circle", { cx: x, cy: y, r, ...dotStyle(n, colors) }, dots);
      const what = n.kind === "yours" ? "your artist" : `recommendation · ${n.status}`;
      svg("title", {}, dot).textContent = `${name} · ${what}`;

      if (narrow && n.kind === "yours" && n.weight === 1) continue;
      const w = name.length * LABEL_W;
      const boxAt = t => ({ x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: t, y1: t + LABEL_H });
      const top = [y + r + 3, y - r - 16].find(t => !overlaps(boxAt(t)));
      if (top === undefined) continue;
      placed.push(boxAt(top));
      const text = svg("text", {
        x, y: top + 10, "text-anchor": "middle", class: `net-label ${n.kind}`,
      }, labels);
      if (n.favorite) svg("tspan", { style: `fill: ${starColor}` }, text).textContent = `${star} `;
      text.append(n.name);
    }
  }

  function mount(net, container, options = {}) {
    draw(net, container, options);
    let lastWidth = container.clientWidth;
    window.addEventListener("resize", () => {
      if (container.clientWidth !== lastWidth) {
        lastWidth = container.clientWidth;
        draw(net, container, options);
      }
    });
  }

  window.TasteNetwork = { draw, mount };
})();
