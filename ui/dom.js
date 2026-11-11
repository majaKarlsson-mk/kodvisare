// Små hjälpfunktioner för att bygga gränssnittet.
export const $ = (sel) => document.querySelector(sel);

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// el('button', { class: 'link', onclick: fn }, 'text', annatElement)
export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid);
  }
  return node;
}

// `kod` i en text blir <code>kod</code>
export function rich(text) {
  const p = document.createElement('p');
  String(text)
    .split('`')
    .forEach((part, i) => p.append(i % 2 ? el('code', {}, part) : part));
  return p;
}

// CSS-klass efter vilken sorts värde det är
export function valClass(snap) {
  if (snap === null) return 't-empty';
  if (typeof snap === 'string') return 't-str';
  if (typeof snap === 'number') return 't-num';
  if (typeof snap === 'boolean') return 't-atom';
  if (snap.$ === 'u') return 't-empty';
  return '';
}

export const baseName = (rel) => rel.split('/').pop();
