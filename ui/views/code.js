// Kodvyn: filens rader, markering av raden som körs, värden bredvid raderna
// och rutan som visas när man hovrar över en funktion.
import { MUL } from '../store.js';
import { short } from '../format.js';
import { recordedCalls, resolveRef, unusedMentions } from '../callsites.js';
import { $, baseName, el, esc } from '../dom.js';

export function createCodeView(app) {
  const { store } = app;
  const tabs = $('#tabs');
  const box = $('#lines');
  const pop = $('#pop');
  let cache = new Map(); // filens id -> { el, lineEls, refs, ran }
  let shown = 0;
  let touched = [];
  let lastPeek = null;
  let showTimer = 0;
  let hideTimer = 0;

  function build(file) {
    const refs = [];
    const marks = file.meta.hl.map(([s, e, cls]) => ({ s, e, cls }));
    for (const r of file.meta.refs) {
      if (!resolveRef(store, file.id, r).length) continue;
      marks.push({ s: r.s, e: r.e, cls: 'fnref', ref: refs.length });
      refs.push(r);
    }
    file.meta.fns.forEach((fn, idx) => {
      if (!fn || fn.ns == null) return;
      marks.push({ s: fn.ns, e: fn.ne, cls: 'fnref', ref: refs.length });
      refs.push({ def: idx, name: fn.name });
    });
    marks.sort((a, b) => a.s - b.s || b.e - a.e);

    const src = file.source;
    const lines = [];
    let line = '';
    let pos = 0;
    const emit = (text, m) => {
      text.split('\n').forEach((part, k) => {
        if (k) {
          lines.push(line);
          line = '';
        }
        if (!part) return;
        line += m
          ? '<span class="' + m.cls + '"' + (m.ref != null ? ' data-ref="' + m.ref + '"' : '') + '>' + esc(part) + '</span>'
          : esc(part);
      });
    };
    for (const m of marks) {
      if (m.s < pos) continue;
      emit(src.slice(pos, m.s));
      emit(src.slice(m.s, m.e), m);
      pos = m.e;
    }
    emit(src.slice(pos));
    lines.push(line);

    const root = el('div', { class: 'file' });
    root.innerHTML = lines
      .map((h, k) => '<div class="ln" data-line="' + (k + 1) + '"><span class="no">' + (k + 1) + '</span><span class="tx">' + h + '</span><span class="iv"></span></div>')
      .join('');
    return { el: root, lineEls: [...root.children], refs, ran: new Set() };
  }

  function view(fileId) {
    let v = cache.get(fileId);
    if (!v) cache.set(fileId, (v = build(store.files.get(fileId))));
    return v;
  }

  function scrollTo(lineEl) {
    const b = box.getBoundingClientRect();
    const r = lineEl.getBoundingClientRect();
    if (r.top < b.top + 30 || r.bottom > b.bottom - 30) {
      box.scrollTop += r.top - b.top - b.height / 2;
    }
  }

  const hasCode = (f) => f.meta.locs.length > 1 || f.meta.fns.length > 1;

  function renderTabs(fileId, at) {
    const files = [...store.files.values()].filter((f) => hasCode(f) || f.id === fileId);
    tabs.replaceChildren(
      ...files.map((f) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            title: f.rel,
            'aria-selected': String(f.id === fileId),
            class: at && at.file.id === f.id ? 'here' : '',
            onclick: () => app.peekAt(f.id, 0),
          },
          baseName(f.rel),
        ),
      ),
    );
  }

  function render() {
    const step = store.step(app.n);
    const at = step && store.loc(step.L);
    let fileId = app.peek ? app.peek.fileId : at ? at.file.id : shown;
    if (!store.files.has(fileId)) {
      const first = [...store.files.values()].find(hasCode) ?? store.files.values().next().value;
      fileId = first ? first.id : 0;
    }
    if (!fileId) {
      shown = 0;
      tabs.replaceChildren();
      box.replaceChildren(el('div', { class: 'empty' }, app.project ? 'Väntar på att koden ska köras …' : 'Välj ett projekt för att börja.'));
      return;
    }
    renderTabs(fileId, at);
    const v = view(fileId);
    if (shown !== fileId || box.firstChild !== v.el) {
      box.replaceChildren(v.el);
      shown = fileId;
    }

    for (const lineEl of touched) {
      lineEl.classList.remove('cur', 'err');
      lineEl.lastChild.textContent = '';
    }
    touched = [];

    // Rader som har körts får mörkare radnummer
    const file = store.files.get(fileId);
    file.meta.locs.forEach((range, li) => {
      if (!range || v.ran.has(li) || !store.visits.has(fileId * MUL + li)) return;
      v.ran.add(li);
      v.lineEls[store.lineOf(file, range[0]) - 1]?.classList.add('ran');
    });

    for (const { ex } of app.errors()) {
      if (ex.file && ex.file.id === fileId && ex.step <= app.n) {
        const lineEl = v.lineEls[ex.line - 1];
        if (lineEl) {
          lineEl.classList.add('err');
          touched.push(lineEl);
        }
      }
    }

    if (step) {
      if (at && at.file.id === fileId) {
        const lineEl = v.lineEls[at.line - 1];
        if (lineEl) {
          lineEl.classList.add('cur');
          touched.push(lineEl);
          if (!app.peek) scrollTo(lineEl);
        }
      }
      // Värden bredvid raderna där de sattes
      const iEnd = store.endOf(app.n);
      const iPrev = app.n > store.first ? store.endOf(app.n - 1) : -1;
      const perLine = new Map();
      for (const id of step.frame < 0 ? [step.frame, 0] : [step.frame]) {
        const frame = store.frames.get(id);
        const fn = frame && store.fn(frame.fn);
        for (const { name, entry } of store.varsAt(id, iEnd)) {
          if (entry.snap && entry.snap.$ === 'f') continue;
          const l = store.loc(entry.L);
          let line = 0;
          if (l) line = l.file.id === fileId ? l.line : 0;
          else if (fn && fn.file.id === fileId) line = fn.line;
          if (!line) continue;
          if (!perLine.has(line)) perLine.set(line, []);
          perLine.get(line).push('<span class="' + (entry.i > iPrev ? 'chg' : '') + '">' + esc(name) + ' = ' + esc(short(entry.snap, 48)) + '</span>');
        }
      }
      for (const [line, items] of perLine) {
        const lineEl = v.lineEls[line - 1];
        if (!lineEl) continue;
        lineEl.lastChild.innerHTML = items.join('  ');
        touched.push(lineEl);
      }
    }

    if (app.peek && app.peek !== lastPeek) {
      lastPeek = app.peek;
      const lineEl = v.lineEls[app.peek.line - 1];
      if (lineEl) {
        lineEl.classList.remove('peek');
        void lineEl.offsetWidth;
        lineEl.classList.add('peek');
        scrollTo(lineEl);
      }
    }
  }

  // Klick på ett radnummer: hoppa till nästa gång raden körs
  box.addEventListener('click', (e) => {
    const no = e.target.closest('.no');
    if (!no || !shown) return;
    const line = Number(no.parentNode.dataset.line);
    const file = store.files.get(shown);
    let visits = [];
    file.meta.locs.forEach((range, li) => {
      if (range && store.lineOf(file, range[0]) === line) visits = visits.concat(store.visits.get(shown * MUL + li) || []);
    });
    visits = visits.filter((n) => n >= store.first).sort((a, b) => a - b);
    if (!visits.length) {
      app.say('Rad ' + line + ' har inte körts i inspelningen.');
      app.peekAt(shown, line);
      return;
    }
    app.go(visits.find((n) => n > app.n) ?? visits[0]);
  });

  // ----- rutan vid hovring över en funktion -----

  function callRow(f) {
    const at = store.loc(f.callLoc);
    const job = !f.parent && store.jobOf(f.id);
    const where = f.parent && at ? 'rad ' + at.line + (at.file.id !== shown ? ' i ' + baseName(at.file.rel) : '') : job ? job.label : 'vid start';
    const args = store
      .args(f)
      .map((a) => a.name + ' = ' + (a.entry ? short(a.entry.snap, 22) : '?'))
      .join(', ');
    const ret = f.hasRet ? ' → ' + short(f.ret, 22) : '';
    const target = f.parent && f.callStep >= store.first ? f.callStep : f.first;
    return el(
      'button',
      { type: 'button', class: 'rowbtn', onclick: () => (hidePop(), app.go(target)) },
      el('span', { class: 'where' }, where),
      el('span', { class: 'what' }, '(' + args + ')' + ret),
    );
  }

  function showPop(span) {
    const v = cache.get(shown);
    const ref = v && v.refs[Number(span.dataset.ref)];
    if (!ref) return;
    const keys = resolveRef(store, shown, ref);
    const fns = keys.map((k) => store.fn(k)).filter(Boolean);
    if (!fns.length) return;
    const fn = fns[0];
    const calls = recordedCalls(store, keys);
    const unused = unusedMentions(store, keys);
    const MAX = 8;

    const parts = [
      el('div', { class: 'pop-title' }, fn.name + (fns.length > 1 ? ' (+' + (fns.length - 1) + ' till med samma namn)' : '')),
      el(
        'button',
        { type: 'button', class: 'link', onclick: () => (hidePop(), app.peekAt(fn.file.id, fn.line)) },
        'Definieras på rad ' + fn.line + ' i ' + baseName(fn.file.rel),
      ),
      el('h3', {}, calls.length ? 'Anropades ' + calls.length + (calls.length === 1 ? ' gång' : ' gånger') + ' i inspelningen' : 'Har inte anropats i inspelningen än'),
      ...calls.slice(0, MAX).map(callRow),
      calls.length > MAX && el('div', { class: 'muted' }, '… och ' + (calls.length - MAX) + ' till. Bevaka funktionen för att se alla.'),
      unused.length > 0 && el('h3', {}, 'Nämns också här (inget anrop har startat härifrån)'),
      ...unused.slice(0, MAX).map((m) =>
        el(
          'button',
          { type: 'button', class: 'rowbtn', onclick: () => (hidePop(), app.peekAt(m.file.id, m.line)) },
          el('span', { class: 'where' }, 'rad ' + m.line),
          el('span', { class: 'what' }, baseName(m.file.rel)),
        ),
      ),
      el(
        'div',
        { class: 'pop-foot' },
        el(
          'button',
          { type: 'button', onclick: () => (hidePop(), app.toggleWatch('fn', fn.short ?? fn.name, true)) },
          'Bevaka funktionen',
        ),
      ),
    ];
    pop.replaceChildren(...parts.filter(Boolean));
    pop.hidden = false;
    const r = span.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function hidePop() {
    clearTimeout(showTimer);
    pop.hidden = true;
  }

  box.addEventListener('mouseover', (e) => {
    const span = e.target.closest('.fnref');
    if (!span) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showPop(span), 250);
  });
  box.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.fnref')) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(hidePop, 250);
  });
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', () => (hideTimer = setTimeout(hidePop, 200)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hidePop());

  return {
    render,
    invalidate() {
      cache = new Map();
      touched = [];
      hidePop();
    },
  };
}
