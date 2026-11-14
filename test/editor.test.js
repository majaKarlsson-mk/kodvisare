import { describe, expect, test } from 'vitest';
import { afterComposition, editFor } from '../ui/editor.js';

// '|' är markören, '‹…›' en markering. Returnerar texten efter redigeringen
// med markören/markeringen utritad, eller null om webbläsaren ska sköta tangenten.
function parse(src) {
  const sel = src.indexOf('‹');
  if (sel >= 0) {
    const end = src.indexOf('›') - 1;
    return { value: src.replace('‹', '').replace('›', ''), start: sel, end };
  }
  const at = src.indexOf('|');
  return { value: src.replace('|', ''), start: at, end: at };
}

function draw(value, start, end) {
  if (start === end) return value.slice(0, start) + '|' + value.slice(start);
  return value.slice(0, start) + '‹' + value.slice(start, end) + '›' + value.slice(end);
}

function apply(edit, state) {
  if (!edit) return null;
  const value = state.value.slice(0, edit.from) + edit.text + state.value.slice(edit.to);
  return draw(value, edit.selStart, edit.selEnd);
}

const press = (src, key, mods = {}) => {
  const state = parse(src);
  return apply(editFor(state, { key, shift: false, mod: false, code: '', ...mods }), state);
};

describe('automatiska par', () => {
  test('parentes stängs och markören hamnar emellan', () => {
    expect(press('|', '(')).toBe('(|)');
    expect(press('x = |;', '[')).toBe('x = [|];');
  });
  test('stängs inte framför ett ord', () => {
    expect(press('|foo', '(')).toBe(null);
  });
  test('markerad text omsluts', () => {
    expect(press('‹a›', '"')).toBe('"‹a›"');
    expect(press('f‹x + 1›', '(')).toBe('f(‹x + 1›)');
  });
  test('sluttecken som redan står där hoppas över', () => {
    expect(press('"|"', '"')).toBe('""|');
    expect(press('f(|)', ')')).toBe('f()|');
  });
  test('citattecken efter en bokstav stängs inte', () => {
    expect(press('don|', "'")).toBe(null);
  });
  test('citattecken som avslutar en öppen sträng får inget nytt par', () => {
    expect(press('x = "abc |', '"')).toBe(null);
    expect(press('`a\nb |', '`')).toBe(null);
    expect(press('x = "a" + |', '"')).toBe('x = "a" + "|"');
  });
  test('backsteg i ett tomt par tar bort båda', () => {
    expect(press('(|)', 'Backspace')).toBe('|');
    expect(press('"|"', 'Backspace')).toBe('|');
  });
  test('backtick från en död tangent får sitt par efteråt', () => {
    const state = parse('`|');
    expect(apply(afterComposition(state, '`'), state)).toBe('`|`');
    const word = parse('`|x');
    expect(afterComposition(word, '`')).toBe(null);
  });
});

describe('indrag', () => {
  test('backsteg i indraget går till förra steget', () => {
    expect(press('    |x', 'Backspace')).toBe('  |x');
    expect(press('   |x', 'Backspace')).toBe('  |x');
  });
  test('enter mellan klamrar lägger } på en egen rad', () => {
    expect(press('  if (x) {|}', 'Enter')).toBe('  if (x) {\n    |\n  }');
  });
  test('enter efter { ger ett steg till', () => {
    expect(press('function f() {|', 'Enter')).toBe('function f() {\n  |');
  });
  test('enter behåller indraget på en rad med text', () => {
    expect(press('  foo|', 'Enter')).toBe('  foo\n  |');
  });
  test('enter utan indrag lämnas åt webbläsaren', () => {
    expect(press('foo|', 'Enter')).toBe(null);
  });
  test('} på en tom rad flyttar ut ett steg', () => {
    expect(press('    |', '}')).toBe('  }|');
  });
  test('tab sätter in två mellanslag', () => {
    expect(press('a|', 'Tab')).toBe('a  |');
  });
  test('tab med flera rader markerade flyttar in raderna', () => {
    expect(press('‹a\nb›', 'Tab')).toBe('‹  a\n  b›');
  });
  test('raden där markeringen slutar i kolumn 0 räknas inte', () => {
    expect(press('‹a\nb\n›c', 'Tab')).toBe('‹  a\n  b\n›c');
  });
  test('skift+tab flyttar ut', () => {
    expect(press('  a|', 'Tab', { shift: true })).toBe('a|');
    expect(press('‹  a\n    b›', 'Tab', { shift: true })).toBe('‹a\n  b›');
  });
});

describe('kommentarer', () => {
  test('cmd+/ kommenterar markerade rader vid minsta indraget', () => {
    expect(press('‹a\n  b›', '/', { mod: true })).toBe('‹// a\n//   b›');
  });
  test('cmd+/ tar bort kommentaren igen', () => {
    expect(press('// a|', '/', { mod: true })).toBe('a|');
    expect(press('  // a|', '/', { mod: true })).toBe('  a|');
  });
  test('cmd+skift+7 (svenskt tangentbord) gör samma sak', () => {
    expect(press('a|', '7', { mod: true, shift: true, code: 'Digit7' })).toBe('// a|');
  });
  test('ingen kommentar när det är avstängt', () => {
    const state = parse('a|');
    expect(editFor(state, { key: '/', shift: false, mod: true, code: '' }, { comment: null })).toBe(null);
  });
});

describe('lämnas åt andra', () => {
  test('cmd+enter kör koden och rörs inte', () => {
    expect(press('a|', 'Enter', { mod: true })).toBe(null);
  });
  test('vanliga bokstäver rörs inte', () => {
    expect(press('a|', 'b')).toBe(null);
  });
});
