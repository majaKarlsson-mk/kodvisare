// Spårningsskriptet. Det körs inne i din sida och tar emot anropen som
// instrumenteringen har lagt in i koden (__kv.s, __kv.v, __kv.e ...).
// Varje anrop blir en händelse i en lång lista som skickas till verktyget.
//
// Händelser:
//   ['s', ram, L]                      ett steg: en sats ska köras
//   ['v', ram, namn, värde, L, m]      en variabel fick ett värde (m = 1: bara innehållet kan ha ändrats)
//   ['e', ram, FN, förälder, lexikal, anropsL, jobb]  en funktion startar
//   ['r', ram, värde]                  return
//   ['x', ram]                         funktionen är klar
//   ['w', ram]                         fortsätter efter await
//   ['a', typ, text, ursprung]         en ny uppgift startar (klick, timeout ...)
//   ['m', typ, text, ursprung]         en markering (fetch skickas, svar kommer)
//   ['t', {name, message}, L, ram]     ett fel kastas
//   ['u', index till 't', extra]       felet fångades aldrig
//   ['c', nivå, [värden]]              console.log
//
// "ram" är ett id för ett funktionsanrop. Negativa id:n är filens toppnivå,
// 0 är det globala scopet.
(function (G) {
  if (G.__kv) return;

  const snap = G.__kvSnap;
  const LIMIT = 200000;
  const sink = G.__kvSink || null; // används av testerna
  const toParent = !sink && G.parent && G.parent !== G ? G.parent : null;
  const setT = typeof G.setTimeout === 'function' ? G.setTimeout.bind(G) : null;
  const microtask =
    typeof G.queueMicrotask === 'function' ? G.queueMicrotask.bind(G) : (f) => Promise.resolve().then(f);

  let buf = [];
  let sent = 0;
  let seq = 0;
  let flushTimer = 0;

  let nextFrame = 1;
  let cur = 0; // ramen som kör just nu (0 = ingen)
  let last = 0; // senaste ramen som körde, nollställs aldrig
  let job = -1; // index till 'a'-händelsen som startade den här uppgiften
  let pending = null;
  let jobSteps = 0;
  let tickQueued = false;
  const frames = new Map();
  const thrown = new WeakMap();

  function flush() {
    flushTimer = 0;
    if (!buf.length) return;
    const events = buf;
    buf = [];
    if (toParent) toParent.postMessage({ kv: 'ev', base: sent, events }, '*');
    sent += events.length;
  }

  function push(ev) {
    if (sink) sink.push(ev);
    else if (toParent) {
      buf.push(ev);
      if (!flushTimer && setT) flushTimer = setT(flush, 40);
    }
    return seq++;
  }

  // När den synkrona koden är klar börjar nästa uppgift från noll.
  function tick() {
    if (tickQueued) return;
    tickQueued = true;
    microtask(() => {
      tickQueued = false;
      cur = 0;
      job = -1;
      pending = null;
      jobSteps = 0;
    });
  }

  function begin() {
    if (pending) {
      job = push(pending);
      pending = null;
    }
    tick();
  }

  function describe(err) {
    if (err && typeof err.message === 'string') return { name: String(err.name || 'Error'), message: err.message };
    return { name: '', message: String(err) };
  }

  function record(err, frame) {
    const isObj = err !== null && (typeof err === 'object' || typeof err === 'function');
    if (isObj && thrown.has(err)) return thrown.get(err);
    const f = frames.get(frame);
    const i = push(['t', describe(err), f ? f.loc : 0, frame]);
    if (isObj) thrown.set(err, i);
    return i;
  }

  G.__kv = {
    s(frame, L) {
      begin();
      let f = frames.get(frame);
      if (!f) {
        f = { parent: 0, loc: 0, resumed: false };
        frames.set(frame, f);
        push(['e', frame, 0, 0, 0, 0, job]);
      }
      f.loc = L;
      cur = last = frame;
      if (++jobSteps > LIMIT) {
        jobSteps = 0;
        throw new Error(
          'Kodvisare stoppade koden efter ' + LIMIT + ' steg utan paus. Det ser ut som en oändlig loop.',
        );
      }
      push(['s', frame, L]);
    },

    e(fn, lexical) {
      begin();
      const id = nextFrame++;
      const parent = cur;
      const pf = frames.get(parent);
      frames.set(id, { parent, loc: 0, resumed: false });
      push(['e', id, fn, parent, lexical, pf ? pf.loc : 0, parent ? -1 : job]);
      cur = last = id;
      return id;
    },

    x(frame) {
      const f = frames.get(frame);
      push(['x', frame]);
      if (f) {
        if (cur === frame) cur = f.resumed ? 0 : f.parent;
        frames.delete(frame);
      }
    },

    v(frame, name, value) {
      const f = frames.get(cur);
      push(['v', frame, name, snap(value), f ? f.loc : 0]);
    },

    // Samma som v, men för när innehållet i ett objekt eller en array kan ha ändrats
    m(frame, name, value) {
      const f = frames.get(cur);
      push(['v', frame, name, snap(value), f ? f.loc : 0, 1]);
    },

    r(frame, value) {
      push(['r', frame, snap(value)]);
      return value;
    },

    q(value) {
      return value;
    },

    t(frame, err) {
      record(err, frame);
      return err;
    },

    aw(frame, value) {
      const f = frames.get(frame);
      if (f && cur === frame) cur = f.resumed ? 0 : f.parent;
      return value;
    },

    ar(frame, value) {
      begin();
      const f = frames.get(frame);
      if (f) f.resumed = true;
      cur = last = frame;
      push(['w', frame]);
      return value;
    },

    // Används av async-hooks.js
    job(kind, label, origin) {
      cur = 0;
      pending = ['a', kind, label, origin == null ? -1 : origin];
      tick();
    },
    mark(kind, label, origin) {
      return push(['m', kind, label, origin == null ? -1 : origin]);
    },
    now() {
      return seq;
    },
    fresh() {
      cur = 0;
    },
    log(level, args) {
      push(['c', level, args.map((a) => snap(a))]);
    },
    uncaught(err, extra) {
      const i = record(err, last);
      push(['u', i, extra || null]);
    },
    flush,
  };

  if (toParent) toParent.postMessage({ kv: 'reset', href: String(G.location && G.location.href) }, '*');
})(globalThis);
