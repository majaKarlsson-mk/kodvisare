// Tar emot händelserna från sidan och svarar på frågor som
// "vad innehöll variabeln X vid steg N?" och "vem anropade den här funktionen?".
// Ingen DOM här, så filen går att testa i Node.

export const MUL = 100000;
export const MAX_STEPS = 200000;

// Sista posten i en sorterad lista där post[key] <= value. -1 om ingen finns.
function lastAtOrBefore(list, value, key) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = key ? list[mid][key] : list[mid];
    if (v <= value) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export class Store {
  constructor() {
    this.files = new Map(); // filens id -> { id, rel, source, meta, lineStarts }
    this.reset();
  }

  reset() {
    this.events = [];
    this.steps = []; // händelseindex för varje steg som finns kvar
    this.dropped = 0; // antal äldsta steg som tagits bort
    this.frames = new Map();
    this.hist = new Map(); // ram -> namn -> [{ i, snap, L }]
    this.names = new Map(); // namn -> [{ i, frame, snap, L }]
    this.marks = []; // klick, timers, fetch ...
    this.throws = new Map();
    this.errors = [];
    this.logs = [];
    this.calls = new Map(); // funktion -> [ram-id]
    this.visits = new Map(); // plats -> [stegnummer]
  }

  // ----- kodens fakta -----

  setFiles(list) {
    this.files = new Map();
    for (const f of list) {
      const lineStarts = [0];
      for (let i = 0; i < f.source.length; i++) if (f.source[i] === '\n') lineStarts.push(i + 1);
      this.files.set(f.id, { ...f, lineStarts });
    }
  }

  lineOf(file, offset) {
    return lastAtOrBefore(file.lineStarts, offset) + 1;
  }

  // Ett platsnummer -> fil, rad och index i filens listor
  loc(L) {
    if (!L) return null;
    const file = this.files.get(Math.floor(L / MUL));
    const li = L % MUL;
    const range = file && file.meta.locs[li];
    if (!range) return null;
    return { file, li, s: range[0], e: range[1], line: this.lineOf(file, range[0]) };
  }

  fn(FN) {
    if (!FN) return null;
    const file = this.files.get(Math.floor(FN / MUL));
    const info = file && file.meta.fns[FN % MUL];
    return info ? { ...info, file, key: FN, line: this.lineOf(file, info.s) } : null;
  }

  hasFile(L) {
    return !L || this.files.has(Math.floor(L / MUL));
  }

  // ----- ta emot händelser -----

  add(events) {
    for (const ev of events) {
      const i = this.events.length;
      this.events.push(ev);
      switch (ev[0]) {
        case 's': {
          const n = this.count;
          this.steps.push(i);
          const f = this.frames.get(ev[1]);
          if (f && f.first < 0) f.first = n;
          let v = this.visits.get(ev[2]);
          if (!v) this.visits.set(ev[2], (v = []));
          v.push(n);
          break;
        }
        case 'e': {
          const [, id, fn, parent, lexical, callLoc, job] = ev;
          this.frames.set(id, { id, fn, parent, lexical, callLoc, job, i, first: -1, exit: -1, callStep: this.count - 1 });
          if (fn) {
            let c = this.calls.get(fn);
            if (!c) this.calls.set(fn, (c = []));
            c.push(id);
          }
          break;
        }
        case 'v': {
          const [, frame, name, snap, L, mutation] = ev;
          let byName = this.hist.get(frame);
          if (!byName) this.hist.set(frame, (byName = new Map()));
          let list = byName.get(name);
          if (!list) byName.set(name, (list = []));
          // lista.push(x) och liknande: spara bara om innehållet faktiskt ändrades
          if (mutation && list.length && JSON.stringify(list[list.length - 1].snap) === JSON.stringify(snap)) break;
          list.push({ i, snap, L });
          let all = this.names.get(name);
          if (!all) this.names.set(name, (all = []));
          all.push({ i, frame, snap, L });
          break;
        }
        case 'r': {
          const f = this.frames.get(ev[1]);
          if (f) {
            f.ret = ev[2];
            f.hasRet = true;
            f.retStep = this.count - 1;
          }
          break;
        }
        case 'x': {
          const f = this.frames.get(ev[1]);
          if (f) f.exit = i;
          break;
        }
        case 'a':
        case 'm':
          this.marks.push({ i, step: this.count, kind: ev[1], label: ev[2], origin: ev[3], job: ev[0] === 'a' });
          break;
        case 't':
          this.throws.set(i, { i, info: ev[1], L: ev[2], frame: ev[3], step: this.count - 1 });
          break;
        case 'u':
          this.errors.push({ i, t: ev[1], extra: ev[2] });
          break;
        case 'c':
          this.logs.push({ i, level: ev[1], args: ev[2], step: this.count - 1 });
          break;
      }
    }
    // Taket: behåll de senaste stegen
    if (this.steps.length > MAX_STEPS) {
      const cut = this.steps.length - MAX_STEPS + 20000;
      this.steps.splice(0, cut);
      this.dropped += cut;
    }
  }

  // ----- steg -----
  // Steg numreras från 0 och behåller sitt nummer även om äldre steg tas bort.

  get first() {
    return this.dropped;
  }
  get count() {
    return this.dropped + this.steps.length;
  }
  get last() {
    return this.count - 1;
  }

  step(n) {
    const i = this.steps[n - this.dropped];
    if (i == null) return null;
    const ev = this.events[i];
    return { n, i, frame: ev[1], L: ev[2] };
  }

  // Steget som pågick när händelse i inträffade
  stepOfEvent(i) {
    const idx = lastAtOrBefore(this.steps, i);
    return idx < 0 ? this.first : idx + this.dropped;
  }

  // Steget där en variabel skrevs: senaste gången radens sats kördes före skrivningen.
  // (Det senaste steget före skrivningen kan ligga inne i en funktion som raden anropade.)
  stepOfWrite(entry) {
    const start = this.stepOfEvent(entry.i);
    if (!entry.L) return start;
    for (let n = start; n >= this.first && n > start - 20000; n--) {
      if (this.step(n).L === entry.L) return n;
    }
    return start;
  }

  // Händelseindex precis innan nästa steg börjar: allt som steg n hann göra
  endOf(n) {
    const next = this.steps[n - this.dropped + 1];
    return next == null ? this.events.length - 1 : next - 1;
  }

  // ----- variabler -----

  valueAt(frame, name, i) {
    const list = this.hist.get(frame)?.get(name);
    if (!list) return null;
    const idx = lastAtOrBefore(list, i, 'i');
    return idx < 0 ? null : list[idx];
  }

  varsAt(frame, i) {
    const out = [];
    const byName = this.hist.get(frame);
    if (!byName) return out;
    for (const [name, list] of byName) {
      const idx = lastAtOrBefore(list, i, 'i');
      if (idx >= 0) out.push({ name, entry: list[idx], writes: idx + 1 });
    }
    return out;
  }

  // Ramarna koden kan se härifrån: sin egen, de omslutande funktionerna, filen och det globala
  scopeChain(frameId) {
    const chain = [];
    let id = frameId;
    while (id && !chain.includes(id) && chain.length < 50) {
      chain.push(id);
      const f = this.frames.get(id);
      id = f ? f.lexical : 0;
    }
    if (!chain.includes(0)) chain.push(0);
    return chain;
  }

  lookup(name, frameId, i) {
    for (const id of this.scopeChain(frameId)) {
      const entry = this.valueAt(id, name, i);
      if (entry) return { ...entry, frame: id };
    }
    return null;
  }

  // ----- anrop -----

  stack(frameId) {
    const out = [];
    let id = frameId;
    while (id && out.length < 200) {
      const f = this.frames.get(id);
      if (!f) break;
      out.push(f);
      id = f.parent;
    }
    return out;
  }

  // Vad som satte igång koden i den här ramen (klick, timeout ...), eller null om det var sidladdningen
  jobOf(frameId) {
    const chain = this.stack(frameId);
    const root = chain[chain.length - 1];
    if (!root || root.job < 0) return null;
    return this.marks.find((m) => m.i === root.job) || null;
  }

  frameName(f) {
    if (!f) return '?';
    if (f.id < 0) {
      const file = this.files.get(-f.id);
      return file ? file.rel : 'filen';
    }
    return this.fn(f.fn)?.name ?? 'funktion';
  }

  args(f) {
    const info = this.fn(f.fn);
    if (!info) return [];
    return info.params.map((name) => ({ name, entry: this.hist.get(f.id)?.get(name)?.[0] ?? null }));
  }
}
