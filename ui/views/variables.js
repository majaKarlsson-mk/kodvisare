// Panelen "Variabler": allt koden kan se vid det valda steget.
import { children, short } from '../format.js';
import { $, el, valClass } from '../dom.js';

// Ett träd över innehållet i ett objekt eller en array
export function tree(snap) {
  const kids = children(snap);
  if (!kids) return null;
  const box = el('div', { class: 'tree' });
  for (const [key, val] of kids) {
    box.append(el('div', { class: 'row' }, el('span', { class: 'key' }, key + ':'), el('span', { class: valClass(val) }, short(val, 60))));
    const sub = tree(val);
    if (sub) box.append(sub);
  }
  if (snap.$ === 'a' && snap.n > kids.length) box.append(el('div', { class: 'row muted' }, '… ' + (snap.n - kids.length) + ' till'));
  if (snap.$ === 'o' && snap.more) box.append(el('div', { class: 'row muted' }, '… ' + snap.more + ' till'));
  return box;
}

export function createVariablesView(app) {
  const { store } = app;
  const body = $('#vars .body');
  const open = new Set();

  function row(frameId, name, entry, changed) {
    const key = frameId + ':' + name;
    const expandable = !!children(entry.snap);
    const isOpen = expandable && open.has(key);
    const isFn = entry.snap && entry.snap.$ === 'f';
    const toggle = () => {
      if (open.has(key)) open.delete(key);
      else open.add(key);
      app.render();
    };
    const out = [
      el(
        'div',
        { class: 'var' + (changed ? ' chg' : '') + (isFn ? ' dim' : '') + (isOpen ? ' open' : '') },
        el(
          'button',
          {
            type: 'button',
            class: 'pin' + (app.isWatched('var', name) ? ' on' : ''),
            title: 'Bevaka ' + name,
            'aria-label': 'Bevaka ' + name,
            onclick: () => app.toggleWatch('var', name),
          },
          '◉',
        ),
        el('span', { class: 'name' + (expandable ? ' expandable' : ''), onclick: expandable ? toggle : null }, name),
        el('span', { class: 'val ' + valClass(entry.snap), title: short(entry.snap, 400) }, short(entry.snap, 70)),
      ),
    ];
    if (isOpen) out.push(tree(entry.snap));
    return out;
  }

  function render() {
    const step = store.step(app.n);
    if (!step) {
      body.replaceChildren(el('p', { class: 'hint' }, 'Ingen kod har körts än.'));
      return;
    }
    const iEnd = store.endOf(app.n);
    const iPrev = app.n > store.first ? store.endOf(app.n - 1) : -1;
    const out = [];
    for (const id of store.scopeChain(step.frame)) {
      const vars = store.varsAt(id, iEnd);
      if (!vars.length) continue;
      const frame = store.frames.get(id);
      let title;
      if (id === 0) title = 'Globalt';
      else if (id < 0) title = 'I filen ' + store.frameName(frame ?? { id });
      else if (id === step.frame) title = 'I ' + store.frameName(frame);
      else title = 'Utanför, i ' + store.frameName(frame) + ' (closure)';
      out.push(el('div', { class: 'group-title' }, title));
      const isFn = (v) => (v.entry.snap && v.entry.snap.$ === 'f' ? 1 : 0);
      vars.sort((a, b) => isFn(a) - isFn(b));
      for (const v of vars) out.push(...row(id, v.name, v.entry, v.entry.i > iPrev));
    }
    if (!out.length) out.push(el('p', { class: 'hint' }, 'Inga variabler har fått värden än.'));
    body.replaceChildren(...out);
  }

  return { render };
}
