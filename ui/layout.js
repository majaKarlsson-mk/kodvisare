// Dragbara avdelare mellan panelerna, som i DevTools.
// Dra i avdelaren med musen (eller använd piltangenterna när den har fokus).
// Dubbelklicka för att återställa. Storlekarna sparas i webbläsaren.
import { $ } from './dom.js';

const KEY = 'kodvisare.layout';
const MIN_COL = 160; // minsta bredd för Din sida och sidopanelen
const MIN_CODE = 240; // koden får aldrig bli smalare än så här
const MIN_PANEL = 64; // minsta höjd för en öppen panel i sidopanelen (rubrik + lite innehåll)
const KEY_STEP = 24; // så många pixlar flyttar en piltangent

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
let saved = load();
function save(patch) {
  saved = { ...saved, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {}
}

const main = $('#main');
const page = $('#page');
const side = $('#side');

// Gemensamt för alla avdelare: musdrag, dubbelklick och piltangenter
function handle(gutter, { horizontal, start, move, reset, nudge }) {
  gutter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const ctx = start();
    if (!ctx) return;
    e.preventDefault();
    gutter.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing', horizontal ? 'resizing-x' : 'resizing-y');
    const onMove = (ev) => move(ctx, horizontal ? ev.clientX - e.clientX : ev.clientY - e.clientY);
    const stop = () => {
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('pointerup', stop);
      gutter.removeEventListener('pointercancel', stop);
      document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
    };
    gutter.addEventListener('pointermove', onMove);
    gutter.addEventListener('pointerup', stop);
    gutter.addEventListener('pointercancel', stop);
  });
  gutter.addEventListener('dblclick', reset);
  gutter.addEventListener('keydown', (e) => {
    const keys = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const i = keys.indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    nudge(i === 0 ? -KEY_STEP : KEY_STEP);
  });
}

// ----- kolumnerna: Din sida | Koden | Sidopanelen -----

const cols = {
  page: { el: page, gutter: $('#gut-page'), sign: 1 },
  side: { el: side, gutter: $('#gut-side'), sign: -1 },
};

function colWidth(name) {
  return cols[name].el.getBoundingClientRect().width;
}

// Håll kolumnen inom gränserna: koden i mitten ska alltid få plats
function clampCol(name, px) {
  const other = name === 'page' ? 'side' : 'page';
  const gutters = cols.page.gutter.offsetWidth + cols.side.gutter.offsetWidth;
  const max = main.clientWidth - colWidth(other) - gutters - MIN_CODE;
  return Math.round(Math.max(MIN_COL, Math.min(max, px)));
}

function setCol(name, px) {
  main.style.setProperty('--w-' + name, px + 'px');
  save({ [name]: px });
}

function resetCol(name) {
  main.style.removeProperty('--w-' + name);
  const { [name]: _, ...rest } = saved;
  saved = rest;
  save({});
}

for (const [name, col] of Object.entries(cols)) {
  handle(col.gutter, {
    horizontal: true,
    start: () => ({ w: colWidth(name) }),
    move: (ctx, dx) => setCol(name, clampCol(name, ctx.w + col.sign * dx)),
    reset: () => resetCol(name),
    nudge: (dx) => setCol(name, clampCol(name, colWidth(name) + col.sign * dx)),
  });
}

// ----- panelerna i sidopanelen: Variabler, Bevakning, Anropskedja, Konsol -----

const panels = [...side.querySelectorAll(':scope > details')];
const rowGutters = [...side.querySelectorAll(':scope > .gutter')];

function openPanels() {
  return panels.filter((p) => p.open);
}

// Närmaste öppna panel ovanför respektive nedanför en avdelare
function neighbours(gutter) {
  const kids = [...side.children];
  const at = kids.indexOf(gutter);
  const above = kids.slice(0, at).reverse().find((k) => k.tagName === 'DETAILS' && k.open);
  const below = kids.slice(at + 1).find((k) => k.tagName === 'DETAILS' && k.open);
  return above && below ? { above, below } : null;
}

function setBasis(panel, px) {
  panel.style.flexBasis = px + 'px';
}

function savePanels() {
  const heights = {};
  for (const p of panels) if (p.style.flexBasis) heights[p.id] = parseInt(p.style.flexBasis, 10);
  save({ panels: heights });
}

function resetPanels() {
  for (const p of panels) p.style.flexBasis = '';
  save({ panels: {} });
}

// Lås alla öppna paneler vid sin nuvarande höjd, så att bara de två vid avdelaren rör sig
function freeze(gutter) {
  const pair = neighbours(gutter);
  if (!pair) return null;
  for (const p of openPanels()) setBasis(p, p.getBoundingClientRect().height);
  const a = pair.above.getBoundingClientRect().height;
  const b = pair.below.getBoundingClientRect().height;
  return { ...pair, a, b, total: a + b };
}

function split(ctx, dy) {
  const a = Math.round(Math.max(MIN_PANEL, Math.min(ctx.total - MIN_PANEL, ctx.a + dy)));
  setBasis(ctx.above, a);
  setBasis(ctx.below, ctx.total - a);
  savePanels();
}

// En avdelare går bara att dra när det finns en öppen panel på båda sidor om den
function refreshRowGutters() {
  for (const g of rowGutters) g.setAttribute('aria-disabled', String(!neighbours(g)));
}

for (const gutter of rowGutters) {
  handle(gutter, {
    horizontal: false,
    start: () => freeze(gutter),
    move: split,
    reset: resetPanels,
    nudge: (dy) => {
      const ctx = freeze(gutter);
      if (ctx) split(ctx, dy);
    },
  });
}
for (const p of panels) p.addEventListener('toggle', refreshRowGutters);

// ----- återställ det som sparats -----

export function setupLayout() {
  if (saved.page) main.style.setProperty('--w-page', saved.page + 'px');
  if (saved.side) main.style.setProperty('--w-side', saved.side + 'px');
  for (const p of panels) if (saved.panels?.[p.id]) setBasis(p, saved.panels[p.id]);
  refreshRowGutters();

  // Blir fönstret smalare får kolumnerna inte knuffa ut koden
  // (under 900 px staplas panelerna i stället, och då finns inga kolumner att hålla inom gränserna)
  const stacked = window.matchMedia('(max-width: 900px)');
  window.addEventListener('resize', () => {
    if (stacked.matches) return;
    for (const name of ['page', 'side']) {
      if (!saved[name]) continue;
      const w = clampCol(name, saved[name]);
      if (w !== saved[name]) setCol(name, w);
    }
  });
}
