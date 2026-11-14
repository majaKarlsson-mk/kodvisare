// Startpunkten: håller ihop inspelningen, det valda steget och alla paneler.
import { Store } from './store.js';
import { explainError } from './provenance.js';
import { $, el } from './dom.js';
import { createCodeView } from './views/code.js';
import { createVariablesView } from './views/variables.js';
import { createWatchView } from './views/watch.js';
import { createStackView, createConsoleView } from './views/stack.js';
import { createErrorView } from './views/error.js';
import { createTimelineView } from './views/timeline.js';
import { createScratchView, SCRATCH_NAME } from './views/scratch.js';
import { setupLayout } from './layout.js';
import { enhanceEditor } from './editor.js';

const store = new Store();
const frame = $('#frame');
const status = $('#status');

function loadWatch() {
  try {
    return JSON.parse(localStorage.getItem('kodvisare.watch') || '[]');
  } catch {
    return [];
  }
}

let explained = { key: '', list: [] };
let message = '';
let queued = false;
let holdTimer = 0;

const app = {
  store,
  n: -1, // valt steg
  live: true, // följ med när nya steg kommer in
  peek: null, // fil och rad som visas utan att steget byts
  project: null,
  problems: [], // filer som inte gick att läsa (syntaxfel)
  watch: loadWatch(),

  attach: (project) => attach(project),
  reload() {
    if (app.project) frame.src = app.project.url;
  },

  go(n) {
    if (store.count === store.first) return;
    app.n = Math.max(store.first, Math.min(store.last, n));
    app.live = app.n >= store.last;
    app.peek = null;
    app.render();
  },
  peekAt(fileId, line) {
    app.peek = { fileId, line };
    app.render();
  },
  isWatched(type, name) {
    return app.watch.some((w) => w.type === type && w.name === name);
  },
  toggleWatch(type, name, onlyAdd) {
    if (app.isWatched(type, name)) {
      if (onlyAdd) return;
      app.watch = app.watch.filter((w) => !(w.type === type && w.name === name));
    } else app.watch = [...app.watch, { type, name }];
    try {
      localStorage.setItem('kodvisare.watch', JSON.stringify(app.watch));
    } catch {}
    $('#watch').open = true;
    app.render();
  },
  // Förklaringar till felen som ingen fångade (räknas om när något nytt har kommit in)
  errors() {
    const key = store.errors.length + ':' + store.files.size + ':' + store.events.length;
    if (explained.key !== key) {
      explained = { key, list: store.errors.map((err) => ({ err, ex: explainError(store, err) })) };
    }
    return explained.list;
  },
  say(text) {
    message = text;
    app.render();
    setTimeout(() => {
      if (message === text) {
        message = '';
        app.render();
      }
    }, 4000);
  },
  // I skrivblocket startar inspelningen om vid varje körning. Då står den gamla vyn
  // kvar tills den nya körningen har gett något, i stället för att panelerna blinkar tomma.
  hold: false,
  holdFor(ms) {
    app.hold = true;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(app.release, ms);
  },
  release() {
    if (!app.hold) return;
    app.hold = false;
    clearTimeout(holdTimer);
    app.render();
  },
  render() {
    if (queued || app.hold) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const v of views) v.render();
      renderStatus();
    });
  },
};

const code = createCodeView(app);
const scratch = createScratchView(app);
const views = [code, createVariablesView(app), createWatchView(app), createStackView(app), createConsoleView(app), createErrorView(app), createTimelineView(app), scratch];

function renderStatus() {
  status.classList.toggle('warn', !!message || app.problems.length > 0);
  if (message) status.textContent = message;
  else if (app.problems.length) status.textContent = 'Kunde inte läsa ' + app.problems[0].file + ': ' + app.problems[0].message;
  else if (!app.project) status.textContent = '';
  else status.textContent = store.count ? store.count.toLocaleString('sv') + ' steg inspelade' + (app.live ? '' : ' · pausad på ett tidigare steg') : 'Väntar på att koden ska köras';
}

// ----- kodens fakta från servern -----

let metaTimer = 0;
function refreshFiles(delay = 120) {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(async () => {
    try {
      const data = await fetch('/api/meta').then((r) => r.json());
      store.setFiles(data.files);
      app.problems = data.problems || [];
      code.invalidate();
      scratch.onFiles();
      app.release(); // nu finns både nya källan och nya värdena, så vyn kan bytas i ett svep
      app.render();
    } catch {}
  }, delay);
}

// ----- händelser från sidan -----

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || !e.data || !e.data.kv) return;
  if (e.data.kv === 'reset') {
    store.reset();
    app.n = -1;
    app.live = true;
    app.peek = null;
    code.invalidate();
    scratch.onReset();
    refreshFiles(300);
    if (scratch.active()) app.holdFor(1500);
    else app.render();
    return;
  }
  if (e.data.kv === 'ev') {
    store.add(e.data.events);
    if (app.live || app.n < store.first) app.n = store.last;
    // Har koden nått en fil vi inte har läst in än?
    if (e.data.events.some((ev) => (ev[0] === 's' && !store.hasFile(ev[2])) || (ev[0] === 'e' && !store.hasFile(ev[2])))) refreshFiles();
    app.render();
  }
});

// ----- stega -----

// Hoppa över anrop: stanna kvar i samma funktion
function stepOver(dir) {
  const cur = store.step(app.n);
  if (!cur) return;
  const f = store.frames.get(cur.frame);
  if (dir > 0) {
    for (let n = app.n + 1; n <= store.last; n++) {
      const s = store.step(n);
      if (s.frame === cur.frame || (f && f.exit >= 0 && s.i > f.exit)) return app.go(n);
    }
    return app.go(store.last);
  }
  for (let n = app.n - 1; n >= store.first; n--) {
    if (store.step(n).frame === cur.frame || (f && n < f.first)) return app.go(n);
  }
  app.go(store.first);
}

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('#picker').hidden) {
    if (e.key === 'Escape' && app.project) $('#picker').hidden = true;
    return;
  }
  if (e.key === 'ArrowRight') e.shiftKey ? stepOver(1) : app.go(app.n + 1);
  else if (e.key === 'ArrowLeft') e.shiftKey ? stepOver(-1) : app.go(app.n - 1);
  else if (e.key === 'Home') app.go(store.first);
  else if (e.key === 'End') app.go(store.last);
  else return;
  e.preventDefault();
});

// ----- välj projekt -----

const picker = $('#picker');
const list = $('#picker-list');
const search = $('#picker-search');
let projects = [];

function attach(project) {
  app.project = project;
  const pick = $('#pick');
  pick.textContent = project.name.split('/').pop();
  pick.title = project.name + ' (klicka för att byta projekt)';
  $('#restart').hidden = false;
  picker.hidden = true;
  store.reset();
  store.setFiles([]);
  app.problems = [];
  app.n = -1;
  code.invalidate();
  scratch.setActive(project.name === SCRATCH_NAME);
  frame.src = project.url;
  app.render();
}

async function open(path) {
  $('#picker-msg').textContent = 'Öppnar …';
  try {
    const res = await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('#picker-msg').textContent = '';
    attach(data);
  } catch (err) {
    $('#picker-msg').textContent = 'Kunde inte öppna projektet: ' + err.message;
  }
}

function renderList() {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = projects.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
  list.replaceChildren(
    ...hits.map((p) => {
      const parts = p.name.split('/');
      const name = parts.pop();
      return el('li', {}, el('button', { type: 'button', onclick: () => open(p.path) }, name, parts.length ? el('div', { class: 'dir' }, parts.join(' / ')) : null));
    }),
  );
  if (!hits.length) list.append(el('li', { class: 'muted' }, projects.length ? 'Inget projekt matchar sökningen.' : 'Hittar inga mappar med en index.html.'));
}

async function showPicker() {
  picker.hidden = false;
  search.value = '';
  showTab(app.project?.name === 'Inklistrad kod' ? 'paste' : app.project?.name === SCRATCH_NAME ? 'scratch' : 'projects');
  try {
    const data = await fetch('/api/projects').then((r) => r.json());
    projects = data.projects;
    $('#picker-root').textContent = 'Mappar med en index.html under ' + data.root;
    renderList();
    return data.current;
  } catch {
    $('#picker-msg').textContent = 'Får ingen kontakt med Kodvisares server. Är den igång?';
  }
}

// ----- klistra in kod -----

const panes = { projects: $('#pane-projects'), paste: $('#pane-paste'), scratch: $('#pane-scratch') };
const pasteCode = $('#paste-code');
const pasteHtml = $('#paste-html');
let snippetLoaded = false;
// Samma hjälp som i skrivblocket: par, indrag och Tab (HTML-rutan utan Cmd+/ för //-kommentarer)
enhanceEditor(pasteCode);
enhanceEditor(pasteHtml, { comment: null });

// Flikarna i projektväljaren: 'projects', 'paste' eller 'scratch'
async function showTab(which) {
  for (const [name, pane] of Object.entries(panes)) {
    pane.hidden = name !== which;
    $('#tab-' + name).setAttribute('aria-selected', String(name === which));
  }
  $('#picker-msg').textContent = '';
  if (which === 'projects') return search.focus();
  if (which === 'scratch') return $('#sb-open').focus();
  if (!snippetLoaded) {
    // Hämta det som klistrades in senast, så att det går att ändra och köra igen
    snippetLoaded = true;
    try {
      const last = await fetch('/api/snippet').then((r) => r.json());
      if (!pasteCode.value) pasteCode.value = last.code;
      if (!pasteHtml.value) pasteHtml.value = last.html;
      if (last.html) pasteHtml.closest('details').open = true;
    } catch {}
  }
  pasteCode.focus();
}

async function runPaste() {
  if (!pasteCode.value.trim()) {
    $('#picker-msg').textContent = 'Klistra in lite JavaScript först.';
    return;
  }
  $('#picker-msg').textContent = 'Startar …';
  try {
    const res = await fetch('/api/snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pasteCode.value, html: pasteHtml.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('#picker-msg').textContent = '';
    $('#console').open = true;
    attach(data);
  } catch (err) {
    $('#picker-msg').textContent = 'Kunde inte köra koden: ' + err.message;
  }
}

$('#tab-projects').addEventListener('click', () => showTab('projects'));
$('#tab-paste').addEventListener('click', () => showTab('paste'));
$('#tab-scratch').addEventListener('click', () => showTab('scratch'));
$('#sb-open').addEventListener('click', () => scratch.open());
panes.paste.addEventListener('submit', (e) => {
  e.preventDefault();
  runPaste();
});
panes.paste.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runPaste();
  }
});

search.addEventListener('input', renderList);
picker.addEventListener('click', (e) => {
  if (e.target === picker && app.project) picker.hidden = true;
});
$('#pick').addEventListener('click', showPicker);
$('#restart').addEventListener('click', app.reload);

setupLayout();
app.render();
showPicker().then((current) => current && attach(current));
