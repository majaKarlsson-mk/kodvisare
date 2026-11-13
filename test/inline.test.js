import { describe, expect, test } from 'vitest';
import { run, storeOf } from './helpers.js';
import { inlineValues, inlineHtml } from '../ui/inline.js';

describe('värden bredvid raderna', () => {
  test('samlar variabler och resultat per rad', async () => {
    const store = storeOf(await run(`const tal = [1, 2, 3];\ntal.map((t) => t * 2);\nlet x = 1;`, { results: true }));
    const perLine = inlineValues(store, 1, store.last);
    expect([...perLine.keys()].sort()).toEqual([1, 2, 3]);
    expect(perLine.get(1)).toEqual([{ kind: 'var', name: 'tal', snap: { $: 'a', n: 3, v: [1, 2, 3] }, changed: false }]);
    expect(perLine.get(2)).toEqual([{ kind: 'out', snap: { $: 'a', n: 3, v: [2, 4, 6] }, changed: false }]);
    expect(perLine.get(3)[0]).toMatchObject({ kind: 'var', name: 'x', snap: 1, changed: true });
  });

  test('visar bara det som hänt fram till valt steg', async () => {
    const store = storeOf(await run(`const tal = [1, 2, 3];\ntal.map((t) => t * 2);`, { results: true }));
    expect(inlineValues(store, 1, store.first).has(2)).toBe(false);
    expect(inlineValues(store, 1, store.last).has(2)).toBe(true);
  });

  test('blir html med pil för resultat', () => {
    const html = inlineHtml([
      { kind: 'var', name: 'a', snap: 1, changed: true },
      { kind: 'out', snap: 'hej', changed: false },
    ]);
    expect(html).toContain('<span class="chg">a = 1</span>');
    expect(html).toContain('<span class="out">→ &quot;hej&quot;</span>');
  });
});
