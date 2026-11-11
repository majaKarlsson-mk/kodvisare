import { describe, expect, test } from 'vitest';
import { run, storeOf } from './helpers.js';
import { explainError } from '../ui/provenance.js';
import { mentions, recordedCalls, resolveRef } from '../ui/callsites.js';
import { MUL } from '../ui/store.js';

// Kör kod som kraschar och förklara felet
async function explain(code) {
  const r = await run(code);
  const store = storeOf(r);
  if (r.error) {
    // Toppnivåfel fångas av webbläsarens error-händelse. Här gör vi samma sak för hand.
    const t = [...store.throws.keys()].at(-1);
    store.add([t == null ? ['t', { name: r.error.name, message: r.error.message }, store.step(store.last).L, store.step(store.last).frame] : ['q']]);
    store.add([['u', [...store.throws.keys()].at(-1), null]]);
  }
  return { store, ex: explainError(store, store.errors[0]) };
}

describe('varifrån kom värdet', () => {
  test('pekar på raden där undefined uppstod, inte där det kraschade', async () => {
    const { ex, store } = await explain(
      [
        `const data = { name: 'pikachu', types: ['electric'], id: 25 };`,
        `function visa(d) {`,
        `  const typ = d.type;`,
        `  return typ.name;`,
        `}`,
        `visa(data);`,
      ].join('\n'),
    );
    expect(ex.title).toBe('Kraschade på rad 4: `typ` är undefined');
    const text = ex.lines.join(' ');
    expect(text).toContain('`typ` fick sitt värde på rad 3, från `d.type`');
    expect(text).toContain('Egenskapen `type` finns inte på `d`. Den har: name, types, id.');
    const jump = ex.jumps.at(-1);
    expect(jump.label).toBe('Gå till rad 3');
    expect(store.loc(store.step(jump.step).L).line).toBe(3);
  });

  test('följer värdet in i funktionen som returnerade det', async () => {
    const { ex, store } = await explain(
      [
        `function hamtaTyp(data) {`,
        `  const typ = data.type;`,
        `  return typ;`,
        `}`,
        `function visa(data) {`,
        `  const typ = hamtaTyp(data);`,
        `  return typ.toUpperCase();`,
        `}`,
        `visa({ name: 'pikachu' });`,
      ].join('\n'),
    );
    const text = ex.lines.join(' ');
    expect(text).toContain('`hamtaTyp` returnerade undefined på rad 3 (`return typ`)');
    expect(text).toContain('Egenskapen `type` finns inte på `data`. Den har: name.');
    expect(store.loc(store.step(ex.jumps.at(-1).step).L).line).toBe(2);
  });

  test('förklarar en parameter som aldrig fick något värde', async () => {
    const { ex } = await explain(`function halsa(namn) {\n  return namn.length;\n}\nhalsa();`);
    expect(ex.lines.join(' ')).toContain('`namn` är en parameter i `halsa` och fick värdet undefined när funktionen anropades på rad 4.');
    expect(ex.jumps.at(-1).label).toBe('Gå till anropet på rad 4');
  });

  test('förklarar en egenskap som saknas mitt i en kedja', async () => {
    const { ex } = await explain(`const p = { name: 'x', sprites: null };\nconst bild = p.sprites.front;`);
    expect(ex.title).toContain('`p.sprites` är null');
    expect(ex.lines.join(' ')).toContain('`p` fick sitt värde på rad 1.');
  });

  test('förklarar ett anrop av något som inte är en funktion', async () => {
    const { ex } = await explain(`const lista = [1, 2];\nlista.pusha(3);`);
    expect(ex.title).toContain('är inte en funktion');
  });
});

describe('var anropas funktionen', () => {
  test('hittar inspelade anrop och ställen som aldrig kördes', async () => {
    const r = await run(
      [`function dubbla(x) {`, `  return x * 2;`, `}`, `dubbla(1);`, `dubbla(2);`, `if (false) {`, `  dubbla(3);`, `}`].join('\n'),
    );
    const store = storeOf(r);
    const ref = r.meta.refs.find((x) => x.name === 'dubbla');
    const keys = resolveRef(store, r.fileId, ref);
    expect(keys).toEqual([r.fileId * MUL + 1]);
    const calls = recordedCalls(store, keys);
    expect(calls.map((f) => store.loc(f.callLoc).line)).toEqual([4, 5]);
    expect(calls.map((f) => f.ret)).toEqual([2, 4]);
    expect(mentions(store, keys).map((m) => m.line)).toEqual([4, 5, 7]);
  });
});
