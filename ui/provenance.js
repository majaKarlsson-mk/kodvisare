// "Varifrån kom värdet?" Tar ett fel och letar bakåt i inspelningen efter
// raden där det felaktiga värdet uppstod. Ingen DOM här.
import { MUL } from './store.js';
import { child, children, isNullish, short, typeName } from './format.js';

const code = (s) => '`' + s + '`';

function keysText(snap) {
  const kids = children(snap);
  if (!kids) return null;
  if (!kids.length) return 'ingenting (det är tomt)';
  const names = kids.slice(0, 8).map(([k]) => k);
  return names.join(', ') + (kids.length > 8 ? ' …' : '');
}

// Värdet av a.b.c vid händelse i, sett från ramen frameId.
// Ger { snap, depth } där depth är hur långt kedjan gick att följa.
function evalChain(store, chain, frameId, i) {
  const root = store.lookup(chain[0], frameId, i);
  if (!root) return null;
  let snap = root.snap;
  for (let d = 1; d < chain.length; d++) {
    if (isNullish(snap)) return { root, snap, depth: d - 1 };
    const next = child(snap, chain[d]);
    if (next === undefined) return { root, snap: undefined, depth: d };
    snap = next;
  }
  return { root, snap, depth: chain.length - 1 };
}

// Förklara varför variabeln `name` har ett tomt värde, utifrån raden där den senast fick sitt värde.
function explainWrite(store, name, entry, out) {
  const frame = store.frames.get(entry.frame);
  const fn = frame && store.fn(frame.fn);

  // Parametrar får sitt värde av anropet
  if (!entry.L && fn && fn.params.includes(name)) {
    const call = store.loc(frame.callLoc);
    out.lines.push(
      code(name) + ' är en parameter i ' + code(fn.name) + ' och fick värdet ' + short(entry.snap) + ' när funktionen anropades' +
        (call ? ' på rad ' + call.line + '.' : '.'),
    );
    if (call) out.jumps.push({ label: 'Gå till anropet på rad ' + call.line, step: frame.callStep });
    return;
  }

  const at = store.loc(entry.L);
  if (!at) return;
  const step = store.stepOfWrite(entry);
  out.jumps.push({ label: 'Gå till rad ' + at.line, step });
  const info = at.file.meta.assigns[at.li]?.[name];

  if (!info) {
    out.lines.push(code(name) + ' fick värdet ' + short(entry.snap) + ' på rad ' + at.line + '.');
    return;
  }
  if (info.rhs == null) {
    out.lines.push(code(name) + ' deklarerades på rad ' + at.line + ' utan något värde, och har inte fått något sedan dess.');
    return;
  }
  out.lines.push(code(name) + ' fick sitt värde på rad ' + at.line + ', från ' + code(info.rhs) + '.');

  if (info.chain && info.chain.length > 1) {
    const writer = store.step(step)?.frame ?? entry.frame;
    const objChain = info.chain.slice(0, -1);
    const prop = info.chain[info.chain.length - 1];
    const obj = evalChain(store, objChain, writer, entry.i - 1);
    const objName = objChain.join('.');
    if (obj && obj.depth === objChain.length - 1 && obj.snap !== undefined) {
      const kids = children(obj.snap);
      if (kids && !kids.some(([k]) => k === prop)) {
        const isArray = obj.snap.$ === 'a';
        out.lines.push(
          isArray
            ? code(objName) + ' är en array med ' + obj.snap.n + ' element, så plats ' + prop + ' finns inte.'
            : 'Egenskapen ' + code(prop) + ' finns inte på ' + code(objName) + '. Den har: ' + keysText(obj.snap) + '.',
        );
      } else if (kids) {
        out.lines.push(code(objName + '.' + prop) + ' fanns, men innehöll ' + short(entry.snap) + ' just då.');
      } else if (!isNullish(obj.snap)) {
        out.lines.push(code(objName) + ' är ' + short(obj.snap, 40) + ' (' + typeName(obj.snap) + '), och har ingen egenskap ' + code(prop) + '.');
      }
    }
  } else if (/\)$/.test(info.rhs)) {
    // Värdet kom från ett funktionsanrop: följ med in i funktionen
    const writer = store.step(step)?.frame ?? entry.frame;
    let callee = null;
    for (const f of store.frames.values()) {
      if (f.parent === writer && f.callLoc === entry.L && f.i < entry.i && (!callee || f.i > callee.i)) callee = f;
    }
    const fn = callee && store.fn(callee.fn);
    if (!fn) {
      out.lines.push('Anropet gav ' + short(entry.snap) + '.');
    } else if (!callee.hasRet) {
      out.lines.push(code(fn.name) + ' kom aldrig fram till någon return, och då blir resultatet undefined.');
      if (callee.first >= 0) out.jumps.push({ label: 'Gå till ' + fn.name, step: callee.first });
    } else {
      const rstep = store.step(callee.retStep);
      const rat = rstep && store.loc(rstep.L);
      const rinfo = rat && rat.file.meta.assigns[rat.li]?.return;
      out.lines.push(
        code(fn.name) + ' returnerade ' + short(entry.snap) + (rat ? ' på rad ' + rat.line : '') + (rinfo ? ' (' + code('return ' + rinfo.rhs) + ')' : '') + '.',
      );
      if (rat) out.jumps.push({ label: 'Gå till rad ' + rat.line, step: callee.retStep });
      if (rinfo && rinfo.chain && out.depth < 3) {
        out.depth++;
        explainChain(store, rinfo.chain, callee.id, store.endOf(callee.retStep), out);
      }
    }
  } else if (info.chain && info.chain.length === 1 && info.chain[0] !== name) {
    // Värdet kopierades från en annan variabel: följ den ett steg till
    const src = store.lookup(info.chain[0], entry.frame, entry.i - 1);
    if (src && isNullish(src.snap) && out.depth < 3) {
      out.depth++;
      explainWrite(store, info.chain[0], src, out);
    }
  }
}

function explainChain(store, chain, frameId, i, out) {
  const res = evalChain(store, chain, frameId, i);
  if (!res) {
    out.lines.push('Hittar inget inspelat värde för ' + code(chain[0]) + '.');
    return;
  }
  const emptyName = chain.slice(0, res.depth + 1).join('.');
  if (res.depth === 0) {
    explainWrite(store, chain[0], res.root, out);
    return;
  }
  // Något mitt i kedjan saknas: a.b är undefined
  const parentChain = chain.slice(0, res.depth);
  const parent = evalChain(store, parentChain, frameId, i);
  const keys = parent && keysText(parent.snap);
  if (keys) out.lines.push(code(parentChain.join('.')) + ' har ingen egenskap ' + code(chain[res.depth]) + '. Den har: ' + keys + '.');
  else out.lines.push(code(emptyName) + ' har inget värde.');
  const at = store.loc(res.root.L);
  if (at) {
    out.lines.push(code(chain[0]) + ' fick sitt värde på rad ' + at.line + '.');
    out.jumps.push({ label: 'Gå till rad ' + at.line, step: store.stepOfWrite(res.root) });
  }
}

// Gör en förklaring av ett fel som ingen fångade.
// Ger { title, message, step, line, file, lines: [text], jumps: [{ label, step }] }
export function explainError(store, err) {
  const th = store.throws.get(err.t);
  const out = { title: 'Koden kraschade', message: '', step: null, lines: [], jumps: [], depth: 0 };
  if (!th) return out;
  const { info } = th;
  out.message = (info.name ? info.name + ': ' : '') + info.message;
  const at = store.loc(th.L);

  if (!at) {
    // Felet hände innan någon rad hann köras, oftast ett syntaxfel
    const where = err.extra && err.extra.line ? ' (rad ' + err.extra.line + ' i ' + String(err.extra.file).split('/').pop() + ')' : '';
    out.title = (info.name === 'SyntaxError' ? 'Syntaxfel' : 'Fel') + where;
    return out;
  }

  out.step = th.step;
  out.line = at.line;
  out.file = at.file;
  out.title = 'Kraschade på rad ' + at.line;
  const meta = at.file.meta;
  const msg = info.message;
  let m;

  if ((m = /Cannot (?:read|set) propert(?:y|ies) of (undefined|null) \((?:reading|setting) '([^']*)'\)/.exec(msg))) {
    const [, kind, prop] = m;
    const candidates = (meta.members[at.li] || []).filter((x) => x.prop === prop);
    let hit = null;
    for (const c of candidates) {
      if (!c.chain) continue;
      const res = evalChain(store, c.chain, th.frame, th.i);
      if (res && res.snap !== undefined && isNullish(res.snap)) {
        hit = c;
        break;
      }
    }
    hit ??= candidates.length === 1 ? candidates[0] : null;
    if (hit) {
      out.title += ': ' + code(hit.src) + ' är ' + kind;
      out.lines.push('Koden försöker läsa ' + code('.' + prop) + ' från ' + code(hit.src) + ', men ' + code(hit.src) + ' är ' + kind + '.');
      if (hit.chain) explainChain(store, hit.chain, th.frame, th.i, out);
    } else {
      out.lines.push('Något på raden är ' + kind + ' när koden försöker läsa ' + code('.' + prop) + ' från det.');
    }
  } else if ((m = /^(.+?) is not a function/.exec(msg))) {
    const name = m[1];
    const hit = (meta.calls[at.li] || []).find((c) => c.src === name || c.src.endsWith('.' + name));
    out.title += ': ' + code(name) + ' är inte en funktion';
    if (hit && hit.chain) {
      const res = evalChain(store, hit.chain, th.frame, th.i);
      if (res && res.snap !== undefined) {
        out.lines.push(code(hit.src) + ' är ' + short(res.snap, 40) + ' (' + typeName(res.snap) + '), så det går inte att anropa med ().');
        if (isNullish(res.snap)) explainChain(store, hit.chain, th.frame, th.i, out);
      }
    }
    if (!out.lines.length) out.lines.push('Koden anropar ' + code(name) + ' med (), men det är ingen funktion. Kolla stavningen.');
  } else if ((m = /^(.+?) is not defined/.exec(msg))) {
    out.title += ': ' + code(m[1]) + ' finns inte';
    out.lines.push(
      'Det finns ingen variabel som heter ' + code(m[1]) + ' här. Kolla stavningen, och att den inte är deklarerad inne i en annan funktion eller ett annat block.',
    );
  } else if (/Assignment to constant variable/.test(msg)) {
    out.title += ': en const kan inte ändras';
    out.lines.push('Raden försöker ge ett nytt värde till en variabel som är deklarerad med const. Använd let om värdet ska kunna bytas.');
  } else if (/before initialization/.test(msg)) {
    out.title += ': variabeln används före sin deklaration';
    out.lines.push('En variabel som deklareras med let eller const går inte att använda på rader som körs före deklarationen.');
  } else if (/Kodvisare stoppade/.test(msg)) {
    out.title = 'Stoppad på rad ' + at.line + ': trolig oändlig loop';
    out.lines.push('Titta på loopens villkor: ändras variabeln som villkoret beror på i varje varv?');
  }
  return out;
}

export { evalChain, MUL };
