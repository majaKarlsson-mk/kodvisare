// Värdena som visas bredvid raderna: variabler där de sattes och resultat av
// uttryckssatser (skrivblocket). Används av kodvyn och av skrivblockets editor.
import { short } from './format.js';
import { esc } from './dom.js';

// rad -> [{ kind: 'var', name, snap, changed } | { kind: 'out', snap, changed }]
// för filen `fileId` så som det såg ut vid steg `n`.
export function inlineValues(store, fileId, n) {
  const perLine = new Map();
  const step = store.step(n);
  if (!step) return perLine;
  const iEnd = store.endOf(n);
  const iPrev = n > store.first ? store.endOf(n - 1) : -1;
  const add = (line, item) => {
    if (!perLine.has(line)) perLine.set(line, []);
    perLine.get(line).push(item);
  };

  // Variablerna i ramen som kör (och filens toppnivå ser även det globala)
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
      add(line, { kind: 'var', name, snap: entry.snap, changed: entry.i > iPrev });
    }
  }

  // Resultat av uttryckssatser: ett per rad, det senaste vinner
  const outs = new Map();
  for (const o of store.outputs) {
    if (o.i > iEnd) continue;
    const l = store.loc(o.L);
    if (!l || l.file.id !== fileId) continue;
    outs.set(l.line, { kind: 'out', snap: o.snap, changed: o.i > iPrev });
  }
  for (const [line, item] of outs) add(line, item);
  return perLine;
}

export function inlineHtml(items) {
  return items
    .map((it) => {
      const cls = it.kind === 'out' ? (it.changed ? 'out chg' : 'out') : it.changed ? 'chg' : '';
      const text = it.kind === 'out' ? '→ ' + short(it.snap, 48) : it.name + ' = ' + short(it.snap, 48);
      return '<span class="' + cls + '">' + esc(text) + '</span>';
    })
    .join('  ');
}
