// Panelen "Bevakning": hela historiken för de variabler och funktioner du har valt.
import { same, short } from '../format.js';
import { recordedCalls } from '../callsites.js';
import { MUL } from '../store.js';
import { $, baseName, el } from '../dom.js';

const MAX_ROWS = 200;

export function createWatchView(app) {
  const { store } = app;
  const body = $('#watch .body');

  function where(L) {
    const at = store.loc(L);
    return at ? 'rad ' + at.line : 'start';
  }

  function varRows(name, iEnd) {
    const all = store.names.get(name) || [];
    // Samma värde två gånger i rad visas bara en gång
    const rows = all.filter((e, k) => k === 0 || e.frame !== all[k - 1].frame || !same(e.snap, all[k - 1].snap));
    if (!rows.length) return [el('p', { class: 'hint' }, 'Har inte fått något värde än.')];
    let now = -1;
    rows.forEach((e, k) => {
      if (e.i <= iEnd) now = k;
    });
    const from = Math.max(0, rows.length - MAX_ROWS);
    return rows.slice(from).map((e, k) =>
      el(
        'button',
        {
          type: 'button',
          class: 'rowbtn' + (k + from === now ? ' now' : '') + (e.i > iEnd ? ' later' : ''),
          onclick: () => app.go(store.stepOfWrite(e)),
        },
        el('span', { class: 'where' }, where(e.L)),
        el('span', { class: 'what' }, short(e.snap, 60)),
      ),
    );
  }

  function fnRows(name, iEnd) {
    const keys = [];
    for (const file of store.files.values()) {
      file.meta.fns.forEach((fn, idx) => {
        if (fn && (fn.short === name || fn.name === name)) keys.push(file.id * MUL + idx);
      });
    }
    const calls = recordedCalls(store, keys);
    if (!calls.length) return [el('p', { class: 'hint' }, 'Har inte anropats än.')];
    let now = -1;
    calls.forEach((f, k) => {
      if (f.i <= iEnd) now = k;
    });
    const from = Math.max(0, calls.length - MAX_ROWS);
    return calls.slice(from).map((f, k) => {
      const at = store.loc(f.callLoc);
      const job = !f.parent && store.jobOf(f.id);
      const args = store
        .args(f)
        .map((a) => (a.entry ? short(a.entry.snap, 22) : '?'))
        .join(', ');
      return el(
        'button',
        {
          type: 'button',
          class: 'rowbtn' + (k + from === now ? ' now' : '') + (f.i > iEnd ? ' later' : ''),
          onclick: () => app.go(f.first >= 0 ? f.first : f.callStep),
        },
        el('span', { class: 'where' }, f.parent && at ? 'rad ' + at.line + ' i ' + baseName(at.file.rel) : job ? job.label : 'start'),
        el('span', { class: 'what' }, '(' + args + ')' + (f.hasRet ? ' → ' + short(f.ret, 30) : '')),
      );
    });
  }

  function render() {
    const iEnd = app.n >= 0 ? store.endOf(app.n) : -1;
    const out = app.watch.map((w) =>
      el(
        'div',
        { class: 'watch-item' },
        el(
          'div',
          { class: 'watch-head' },
          el('span', { class: 'mono' }, w.type === 'fn' ? w.name + '()' : w.name),
          el('button', { type: 'button', title: 'Sluta bevaka', 'aria-label': 'Sluta bevaka ' + w.name, onclick: () => app.toggleWatch(w.type, w.name) }, '×'),
        ),
        el('div', { class: 'rows' }, w.type === 'fn' ? fnRows(w.name, iEnd) : varRows(w.name, iEnd)),
      ),
    );
    if (!out.length) {
      out.push(el('p', { class: 'hint' }, 'Klicka på ◉ vid en variabel, eller hovra över en funktion i koden, för att följa den genom hela körningen.'));
    }
    const input = el('input', { type: 'text', placeholder: 'Variabelnamn', 'aria-label': 'Variabel att bevaka' });
    out.push(
      el(
        'form',
        {
          onsubmit: (e) => {
            e.preventDefault();
            const name = input.value.trim();
            if (name) app.toggleWatch('var', name, true);
          },
        },
        input,
        el('button', { type: 'submit' }, 'Bevaka'),
      ),
    );
    // Behåll det man håller på att skriva
    const typing = body.querySelector('input');
    const text = typing && document.activeElement === typing ? typing.value : null;
    body.replaceChildren(...out);
    if (text != null) {
      input.value = text;
      input.focus();
    }
  }

  return { render };
}
