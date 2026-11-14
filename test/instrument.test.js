import { describe, expect, test } from 'vitest';
import { run, storeOf } from './helpers.js';

const values = (store, name) => (store.names.get(name) || []).map((e) => e.snap);

describe('instrumenteringen', () => {
  test('ändrar inte vad koden gör', async () => {
    const r = await run(`
      function fak(n) { return n <= 1 ? 1 : n * fak(n - 1); }
      const dubbla = [1, 2, 3].map((x) => x * 2);
      let text = '';
      for (const d of dubbla) text += d;
      console.log(fak(5), text);
    `);
    expect(r.error).toBeNull();
    expect(r.logs).toEqual([[120, '246']]);
  });

  test('spelar in varje varv i en loop', async () => {
    const store = storeOf(await run(`let summa = 0;\nfor (let i = 0; i < 3; i++) {\n  summa += i;\n}`));
    expect(values(store, 'summa')).toEqual([0, 0, 1, 3]);
    const bodyVisits = [...store.visits.entries()].find(([L]) => store.loc(L).line === 3)[1];
    expect(bodyVisits).toHaveLength(3);
  });

  test('håller isär två closures av samma funktion', async () => {
    const store = storeOf(
      await run(`
        function raknare(start) { let antal = start; return () => { antal++; return antal; }; }
        const a = raknare(10);
        const b = raknare(100);
        a(); a(); b();
      `),
    );
    const perFrame = new Map();
    for (const e of store.names.get('antal')) perFrame.set(e.frame, [...(perFrame.get(e.frame) || []), e.snap]);
    expect([...perFrame.values()]).toEqual([[10, 11, 12], [100, 101]]);
  });

  test('visar om en array när den ändras med push', async () => {
    const store = storeOf(await run(`const lista = [1];\nlista.push(2);\nlista.length;`));
    expect(values(store, 'lista').map((s) => s.v)).toEqual([[1], [1, 2]]);
  });

  test('spelar in this i klassmetoder', async () => {
    const store = storeOf(
      await run(`
        class Bok { constructor(titel) { this.titel = titel; } visa() { return this.titel; } }
        new Bok('Emil').visa();
      `),
    );
    const names = [...store.frames.values()].map((f) => store.frameName(f));
    expect(names).toContain('new Bok');
    expect(names).toContain('Bok.visa');
    expect(values(store, 'this').at(-1).k).toEqual([['titel', 'Emil']]);
  });

  test('vet vem som anropade en funktion, och med vad', async () => {
    const store = storeOf(await run(`function inre(x) { return x + 1; }\nfunction yttre() {\n  return inre(41);\n}\nyttre();`));
    const inre = [...store.frames.values()].find((f) => store.frameName(f) === 'inre');
    expect(store.stack(inre.id).map((f) => store.frameName(f))).toEqual(['inre', 'yttre', 'test.js']);
    expect(store.loc(inre.callLoc).line).toBe(3);
    expect(store.args(inre)[0].entry.snap).toBe(41);
    expect(inre.ret).toBe(42);
  });

  test('fortsätter i rätt funktion efter await', async () => {
    const r = await run(`
      async function hamta() { const svar = await Promise.resolve(7); return svar * 2; }
      async function start() { const a = await hamta(); console.log(a); }
      start();
    `);
    expect(r.logs).toEqual([[14]]);
    const store = storeOf(r);
    expect(values(store, 'svar')).toEqual([7]);
    expect(values(store, 'a')).toEqual([14]);
    expect(r.events.filter((e) => e[0] === 'w')).toHaveLength(2);
  });

  test('stoppar en oändlig loop', async () => {
    const r = await run(`let i = 0;\nwhile (true) { i++; }`);
    expect(r.error.message).toMatch(/oändlig loop/);
  });

  // Skrivblocket stänger { av sig själv, så while (x) {} kan köras medan man tänker
  test('stoppar en oändlig loop med tom kropp', async () => {
    for (const code of [`let i = 0;\nwhile (i < 10) {\n  \n}`, `for (;;);`, `do {} while (true);`, `for (let i = 0; ; ) {}`]) {
      const r = await run(code);
      expect(r.error?.message, code).toMatch(/oändlig loop/);
    }
  });

  test('klarar cirkulära objekt', async () => {
    const store = storeOf(await run(`const a = { namn: 'a' };\na.jag = a;\na.namn;`));
    const last = values(store, 'a').at(-1);
    expect(last.k[1][1].v).toMatch(/sig själv/);
  });
});

// Skrivblocket visar värdet av uttryckssatser på toppnivå, som konsolen gör
describe('resultat på toppnivå', () => {
  const outputs = (r) => r.events.filter((e) => e[0] === 'o');

  test('rapporterar värdet av ett uttryck på toppnivå', async () => {
    const r = await run(`const tal = [1, 2, 3];\ntal.map((t) => t * 2);`, { results: true });
    expect(r.error).toBeNull();
    const o = outputs(r);
    expect(o).toHaveLength(1);
    expect(o[0][2]).toEqual({ $: 'a', n: 3, v: [2, 4, 6] });
    const store = storeOf(r);
    expect(store.loc(o[0][3]).line).toBe(2);
    expect(store.outputs).toHaveLength(1);
    expect(store.outputs[0].snap).toEqual({ $: 'a', n: 3, v: [2, 4, 6] });
    expect(store.loc(store.step(store.outputs[0].step).L).line).toBe(2);
  });

  test('hoppar över console.log, tilldelningar och ++', async () => {
    const r = await run(`console.log(1);\nlet x = 1;\nx = 2;\nx++;\nx += 1;`, { results: true });
    expect(outputs(r)).toHaveLength(0);
    expect(r.logs).toEqual([[1]]);
  });

  test('tysta anrop som ger undefined, men visar undefined från ett uttryck', async () => {
    const r = await run(`[].forEach(() => {});\nconst o = {};\no.saknas;`, { results: true });
    const o = outputs(r);
    expect(o).toHaveLength(1);
    expect(o[0][2]).toEqual({ $: 'u' });
  });

  test('gör ingenting utan inställningen', async () => {
    const r = await run(`const tal = [1, 2, 3];\ntal.map((t) => t * 2);\nconsole.log(tal.length);`);
    expect(outputs(r)).toHaveLength(0);
    expect(r.logs).toEqual([[3]]);
  });

  test('samsas med omvisningen av en array efter push', async () => {
    const r = await run(`const l = [1];\nl.push(2);`, { results: true });
    expect(outputs(r).map((e) => e[2])).toEqual([2]);
    expect(values(storeOf(r), 'l')).toEqual([{ $: 'a', n: 1, v: [1] }, { $: 'a', n: 2, v: [1, 2] }]);
  });

  test('rapporterar inte uttryck inne i funktioner', async () => {
    const r = await run(`function f() { 1 + 1; }\nf();`, { results: true });
    expect(outputs(r)).toHaveLength(0);
  });
});
