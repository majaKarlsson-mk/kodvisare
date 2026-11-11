// Gör om en ögonblicksbild (se runtime/snapshot.js) till text.

const clip = (s, max) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);

export function isNullish(snap) {
  return snap === null || (snap && snap.$ === 'u');
}

export function typeName(snap) {
  if (snap === null) return 'null';
  if (typeof snap !== 'object') return typeof snap;
  return { u: 'undefined', f: 'funktion', a: 'array', o: 'objekt', e: 'element', n: 'värde' }[snap.$] ?? 'värde';
}

export function short(snap, max = 60) {
  if (snap === null) return 'null';
  switch (typeof snap) {
    case 'string':
      return clip(JSON.stringify(snap), max);
    case 'number':
    case 'boolean':
      return String(snap);
  }
  switch (snap.$) {
    case 'u':
      return 'undefined';
    case 'n':
      return clip(snap.v, max);
    case 'f':
      return 'ƒ ' + (snap.n || '') + '()';
    case 'e':
      return snap.d;
    case 'a': {
      if (!snap.v) return 'Array(' + snap.n + ')';
      const inner = Math.max(12, Math.floor(max / 3));
      const items = snap.v.map((x) => short(x, inner));
      if (snap.n > snap.v.length) items.push('…');
      return clip('[' + items.join(', ') + ']', max);
    }
    case 'o': {
      const head = snap.c ? snap.c + ' ' : '';
      if (!snap.k) return head + '{…}';
      const inner = Math.max(12, Math.floor(max / 3));
      const items = snap.k.map(([k, v]) => k + ': ' + short(v, inner));
      if (snap.more) items.push('…');
      return clip(head + '{' + items.join(', ') + '}', max);
    }
  }
  return '?';
}

// Barnen till ett objekt eller en array, som [nyckel, värde]
export function children(snap) {
  if (!snap || typeof snap !== 'object') return null;
  if (snap.$ === 'a' && snap.v) return snap.v.map((v, i) => [String(i), v]);
  if (snap.$ === 'o' && snap.k) return snap.k;
  return null;
}

// Följ en kedja av egenskaper genom en ögonblicksbild. undefined om den inte går att följa.
export function child(snap, key) {
  const kids = children(snap);
  if (!kids) return undefined;
  const hit = kids.find(([k]) => k === key);
  return hit ? hit[1] : { $: 'u', missing: true };
}

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
