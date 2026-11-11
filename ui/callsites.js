// Var anropas en funktion? Både anrop som faktiskt kördes i inspelningen
// och ställen i koden som nämner funktionen. Ingen DOM här.
import { MUL } from './store.js';

// En referens i koden -> nycklarna till funktionerna den kan peka på
export function resolveRef(store, fileId, ref) {
  if (ref.def) return [fileId * MUL + ref.def];
  if (ref.fn) return [fileId * MUL + ref.fn];
  const keys = [];
  for (const file of store.files.values()) {
    file.meta.fns.forEach((fn, idx) => {
      if (fn && fn.short === ref.name) keys.push(file.id * MUL + idx);
    });
  }
  return keys;
}

// Alla inspelade anrop av funktionerna, äldst först
export function recordedCalls(store, keys) {
  const out = [];
  for (const key of keys) for (const id of store.calls.get(key) || []) out.push(store.frames.get(id));
  return out.sort((a, b) => a.i - b.i);
}

// Alla ställen i koden som nämner funktionerna
export function mentions(store, keys) {
  const wanted = new Set(keys);
  const out = [];
  for (const file of store.files.values()) {
    for (const ref of file.meta.refs) {
      if (resolveRef(store, file.id, ref).some((k) => wanted.has(k))) {
        out.push({ file, s: ref.s, line: store.lineOf(file, ref.s) });
      }
    }
  }
  return out;
}

// Ställen som nämner funktionen men där inget inspelat anrop startade
export function unusedMentions(store, keys) {
  const ran = new Set();
  for (const f of recordedCalls(store, keys)) {
    const at = store.loc(f.callLoc);
    if (at) ran.add(at.file.id + ':' + at.line);
  }
  const seen = new Set();
  return mentions(store, keys).filter((m) => {
    const id = m.file.id + ':' + m.line;
    if (ran.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
