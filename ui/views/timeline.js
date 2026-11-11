// Tidslinjen: dra för att röra dig genom hela körningen.
import { $, baseName, el } from '../dom.js';

const MAX_MARKS = 150;

export function createTimelineView(app) {
  const { store } = app;
  const range = $('#tl-range');
  const marks = $('#tl-marks');
  const info = $('#tl-info');
  const jobEl = $('#tl-job');
  const visitsEl = $('#tl-visits');
  let marksKey = '';

  range.addEventListener('input', () => app.go(Number(range.value)));
  $('#tl-first').addEventListener('click', () => app.go(store.first));
  $('#tl-prev').addEventListener('click', () => app.go(app.n - 1));
  $('#tl-next').addEventListener('click', () => app.go(app.n + 1));
  $('#tl-last').addEventListener('click', () => app.go(store.last));

  function renderMarks() {
    const errors = app.errors().filter((x) => x.ex.step != null);
    const key = store.marks.length + ':' + errors.length + ':' + store.first + ':' + store.last;
    if (key === marksKey) return;
    marksKey = key;
    const span = Math.max(1, store.last - store.first);
    const pct = (n) => (Math.max(0, Math.min(span, n - store.first)) / span) * 100 + '%';
    let list = store.marks.filter((m) => m.step >= store.first);
    if (list.length > MAX_MARKS) {
      const every = Math.ceil(list.length / MAX_MARKS);
      list = list.filter((_, k) => k % every === 0);
    }
    marks.replaceChildren(
      ...list.map((m) =>
        el('button', {
          type: 'button',
          class: m.kind,
          style: 'left:' + pct(m.step),
          title: m.label,
          'aria-label': m.label,
          onclick: () => app.go(m.step),
        }),
      ),
      ...errors.map(({ ex }) =>
        el('button', {
          type: 'button',
          class: 'error',
          style: 'left:' + pct(ex.step),
          title: ex.title.replaceAll('`', ''),
          'aria-label': 'Fel: ' + ex.title.replaceAll('`', ''),
          onclick: () => app.go(ex.step),
        }),
      ),
    );
  }

  function render() {
    const step = store.step(app.n);
    range.min = store.first;
    range.max = Math.max(store.first, store.last);
    range.value = app.n;
    range.disabled = !step;
    renderMarks();

    if (!step) {
      info.textContent = '';
      jobEl.textContent = '';
      visitsEl.replaceChildren();
      return;
    }
    const at = store.loc(step.L);
    info.textContent =
      'Steg ' + (app.n + 1).toLocaleString('sv') + ' av ' + store.count.toLocaleString('sv') + (at ? ' · rad ' + at.line + ' i ' + baseName(at.file.rel) : '');

    const job = store.jobOf(step.frame);
    jobEl.textContent = (job ? 'Startades av: ' + job.label : 'Körs när sidan laddas') + (store.dropped ? ' · De äldsta stegen har tagits bort (taket är 200 000)' : '');

    // Hur många gånger just den här raden har körts: praktiskt i loopar
    const visits = (store.visits.get(step.L) || []).filter((n) => n >= store.first);
    const k = visits.indexOf(app.n);
    if (visits.length > 1 && k >= 0) {
      visitsEl.replaceChildren(
        'Raden har körts ' + visits.length + ' gånger. Det här är gång ' + (k + 1) + '. ',
        el('button', { type: 'button', disabled: k === 0, title: 'Förra gången raden kördes', onclick: () => app.go(visits[k - 1]) }, '◀ förra'),
        ' ',
        el('button', { type: 'button', disabled: k === visits.length - 1, title: 'Nästa gång raden körs', onclick: () => app.go(visits[k + 1]) }, 'nästa ▶'),
      );
    } else visitsEl.replaceChildren();
  }

  return { render };
}
