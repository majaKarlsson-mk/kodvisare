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
import { setupLayout } from './layout.js';

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
let problems = [];
let queued = false;

const app = {
  store,
  n: -1, // valt steg
  live: true, // följ med när nya steg kommer in
  peek: null, // fil och rad som visas utan att steget byts
  project: null,
  watch: loadWatch(),

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
  render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const v of views) v.render();
      renderStatus();
    });
  },
};

const code = createCodeView(app);
const views = [code, createVariablesView(app), createWatchView(app), createStackView(app), createConsoleView(app), createErrorView(app), createTimelineView(app)];

function renderStatus() {
  status.classList.toggle('warn', !!message || problems.length > 0);
  if (message) status.textContent = message;
  else if (problems.length) status.textContent = 'Kunde inte läsa ' + problems[0].file + ': ' + problems[0].message;
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
      problems = data.problems || [];
      code.invalidate();
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
    refreshFiles(300);
    app.render();
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
  app.n = -1;
  code.invalidate();
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
  showTab(app.project?.name === 'Inklistrad kod');
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

const paneProjects = $('#pane-projects');
const panePaste = $('#pane-paste');
const pasteCode = $('#paste-code');
const pasteHtml = $('#paste-html');
let snippetLoaded = false;

async function showTab(paste) {
  paneProjects.hidden = paste;
  panePaste.hidden = !paste;
  $('#tab-projects').setAttribute('aria-selected', String(!paste));
  $('#tab-paste').setAttribute('aria-selected', String(paste));
  $('#picker-msg').textContent = '';
  if (!paste) return search.focus();
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

$('#tab-projects').addEventListener('click', () => showTab(false));
$('#tab-paste').addEventListener('click', () => showTab(true));
panePaste.addEventListener('submit', (e) => {
  e.preventDefault();
  runPaste();
});
panePaste.addEventListener('keydown', (e) => {
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
$('#restart').addEventListener('click', () => {
  if (app.project) frame.src = app.project.url;
});

setupLayout();
app.render();
showPicker().then((current) => current && attach(current));
