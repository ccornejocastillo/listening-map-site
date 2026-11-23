// What a chart has in focus, shared by the network and the branch graph. Two layers: `hover` (the mouse over a dot,
// a line or a legend entry, or a legend entry focused with the keyboard) and `pin` (tapped or clicked, until tapped
// again or the background is tapped). What's hovered wins; when nothing is, the pin shows.
// A focus is a small object: { item } for one artist or line, { week } for a week of the branch graph, or { key } for
// a legend entry (the entry's data-filter).

const current = state => state.hover ?? state.pin;
const same = (a, b) => Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);

// Clicking or tapping something pins it, or unpins it when it already was
function toggle(state, f) {
  state.pin = same(state.pin, f) ? null : f;
}

// A legend's entries with data-filter become filters: hovering, focusing or tapping one lights up what it names
function bindLegend(legend, state, update) {
  const keyOf = el => el?.closest?.("[data-filter]")?.dataset.filter ?? null;
  legend.addEventListener("pointerover", e => {
    const key = keyOf(e.target);
    if (e.pointerType === "mouse" && key) { state.hover = { key }; update(); }
  });
  legend.addEventListener("pointerout", e => {
    if (e.pointerType === "mouse" && keyOf(e.target) && keyOf(e.target) !== keyOf(e.relatedTarget)) { state.hover = null; update(); }
  });
  legend.addEventListener("focusin", e => { const key = keyOf(e.target); if (key) { state.hover = { key }; update(); } });
  legend.addEventListener("focusout", () => { state.hover = null; update(); });
  legend.addEventListener("click", e => {
    const key = keyOf(e.target);
    if (!key) return;
    toggle(state, { key });
    state.hover = null;
    update();
  });
}

// The entry in focus is marked, and says so to screen readers
function markLegend(legend, state) {
  const key = current(state)?.key;
  for (const b of legend.querySelectorAll("[data-filter]")) {
    const on = b.dataset.filter === key;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on && same(state.pin, { key })));
  }
}

export { current, toggle, bindLegend, markLegend };
