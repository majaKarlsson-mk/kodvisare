// Gör en "ögonblicksbild" av ett värde: en liten kopia som går att skicka
// till verktyget och visa senare, även om originalet har ändrats sedan dess.
//
// Format:
//   tal, strängar, true/false, null  -> som de är
//   { $: 'u' }                       -> undefined
//   { $: 'n', v: 'NaN' }             -> något som visas som ren text (NaN, Promise, datum ...)
//   { $: 'f', n: 'namn' }            -> funktion
//   { $: 'a', n: längd, v: [...] }   -> array (v är null om vi nått maxdjupet)
//   { $: 'o', c: 'Klass', k: [[nyckel, värde], ...], more: antal } -> objekt
//   { $: 'e', d: '<h1#rubrik>' }     -> DOM-element
(function (G) {
  const MAX_DEPTH = 3;
  const MAX_KEYS = 50;
  const MAX_STR = 200;

  function describeElement(node) {
    if (node === G.document) return 'document';
    if (node.nodeType === 3) return '#text';
    if (node.nodeType !== 1) return node.nodeName || 'node';
    let d = '<' + node.tagName.toLowerCase();
    if (node.id) d += '#' + node.id;
    const cls = typeof node.className === 'string' ? node.className.trim() : '';
    if (cls) d += '.' + cls.split(/\s+/).slice(0, 2).join('.');
    return d + '>';
  }

  function isNode(v) {
    return typeof G.Node === 'function' && v instanceof G.Node;
  }

  function className(v) {
    const proto = Object.getPrototypeOf(v);
    const name = proto && proto.constructor && proto.constructor.name;
    return name && name !== 'Object' ? name : undefined;
  }

  function text(v) {
    return { $: 'n', v };
  }

  function pairs(entries, depth, seen, total) {
    const k = [];
    for (const [key, val] of entries) {
      if (k.length >= MAX_KEYS) break;
      k.push([String(key), snap(val, depth + 1, seen)]);
    }
    return { k, more: Math.max(0, total - k.length) };
  }

  function snapObject(v, depth, seen) {
    if (v === G) return text('window');
    if (seen.includes(v)) return text('(pekar tillbaka på sig själv)');
    if (isNode(v)) return { $: 'e', d: describeElement(v) };
    if (v instanceof Date) return text(isNaN(v) ? 'Invalid Date' : v.toISOString());
    if (v instanceof RegExp) return text(String(v));
    if (typeof G.Promise === 'function' && v instanceof G.Promise) return text('Promise');
    if (v instanceof Error) {
      return { $: 'o', c: v.name, k: [['message', String(v.message)]], more: 0 };
    }

    const isArray = Array.isArray(v);
    const isList =
      !isArray &&
      ((typeof G.NodeList === 'function' && v instanceof G.NodeList) ||
        (typeof G.HTMLCollection === 'function' && v instanceof G.HTMLCollection));

    if (depth >= MAX_DEPTH) {
      if (isArray || isList) return { $: 'a', n: v.length, v: null };
      return { $: 'o', c: className(v), k: null, more: 0 };
    }

    seen.push(v);
    let out;
    if (isArray || isList) {
      const items = [];
      const n = Math.min(v.length, MAX_KEYS);
      for (let i = 0; i < n; i++) items.push(snap(v[i], depth + 1, seen));
      out = { $: 'a', n: v.length, v: items };
      if (isList) out.c = className(v);
    } else if (v instanceof Map) {
      out = { $: 'o', c: 'Map(' + v.size + ')', ...pairs(v.entries(), depth, seen, v.size) };
    } else if (v instanceof Set) {
      const entries = Array.from(v).map((val, i) => [i, val]);
      out = { $: 'o', c: 'Set(' + v.size + ')', ...pairs(entries, depth, seen, v.size) };
    } else if (typeof G.Response === 'function' && v instanceof G.Response) {
      out = { $: 'o', c: 'Response', k: [['status', v.status], ['ok', v.ok], ['url', String(v.url)]], more: 0 };
    } else if (typeof G.Event === 'function' && v instanceof G.Event) {
      out = {
        $: 'o',
        c: className(v) || 'Event',
        k: [['type', v.type], ['target', snap(v.target, depth + 1, seen)]],
        more: 0,
      };
    } else {
      const keys = Object.keys(v);
      const entries = [];
      for (const key of keys.slice(0, MAX_KEYS)) {
        const desc = Object.getOwnPropertyDescriptor(v, key);
        // Getters körs inte: de kan ha sidoeffekter.
        entries.push([key, desc && 'value' in desc ? desc.value : text('(getter)')]);
      }
      out = { $: 'o', c: className(v), ...pairs(entries, depth, seen, keys.length) };
    }
    seen.pop();
    return out;
  }

  function snap(v, depth, seen) {
    const type = typeof v;
    if (v === null || type === 'boolean') return v;
    if (type === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
    if (type === 'number') return Number.isFinite(v) ? v : text(String(v));
    if (type === 'undefined') return { $: 'u' };
    if (type === 'function') return { $: 'f', n: v.name || '' };
    if (type === 'bigint') return text(v + 'n');
    if (type === 'symbol') return text(String(v));
    try {
      return snapObject(v, depth, seen);
    } catch {
      return text('(kunde inte läsas)');
    }
  }

  G.__kvSnap = (v) => snap(v, 0, []);
  G.__kvSnap.el = describeElement;
})(globalThis);
