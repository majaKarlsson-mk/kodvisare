import { describe, expect, test } from 'vitest';
import { highlightLines } from '../ui/highlight.js';

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('färgad kod', () => {
  test('nyckelord och tal', () => {
    expect(highlightLines('const x = 1;')).toEqual(['<span class="kw">const</span> x = <span class="num">1</span>;']);
  });

  test('strängar escapas', () => {
    expect(highlightLines('"<a>"')).toEqual(['<span class="str">&quot;&lt;a&gt;&quot;</span>']);
  });

  test('kommentar över flera rader', () => {
    expect(highlightLines('/* a\nb */ x')).toEqual(['<span class="com">/* a</span>', '<span class="com">b */</span> x']);
    expect(highlightLines('x // hej')).toEqual(['x <span class="com">// hej</span>']);
  });

  test('en oavslutad sträng slutar vid radslutet', () => {
    expect(highlightLines('"abc\nlet y')[1]).toBe('<span class="kw">let</span> y');
  });

  test('template literal med uttryck', () => {
    const [line] = highlightLines('`a ${b + 1} c`');
    expect(line).toContain('<span class="num">1</span>');
    expect(line).toContain('<span class="str">`a </span>');
    expect(line).toContain('<span class="str"> c`</span>');
  });

  test('template med objekt i uttrycket', () => {
    const [line] = highlightLines('`${ {a: 1}.a } x`');
    expect(line).toContain('<span class="str"> x`</span>');
  });

  test('regex och division', () => {
    expect(highlightLines('a / b / c')[0]).not.toContain('class="str"');
    expect(highlightLines('x = /ab+/g')[0]).toContain('<span class="str">/ab+/g</span>');
    expect(highlightLines('s.split(/,\\s*/)')[0]).toContain('<span class="str">/,\\s*/</span>');
  });

  test('egenskaper efter punkt färgas inte', () => {
    expect(highlightLines('map.get(1)')[0]).not.toContain('class="kw"');
    expect(highlightLines('x = null')[0]).toContain('<span class="atom">null</span>');
    expect(highlightLines('let set = 1')[0]).toContain('<span class="kw">let</span>');
  });

  test('tal med decimaler, exponent och bigint', () => {
    expect(highlightLines('1.5e3 + 10n + 0xff')[0]).toBe('<span class="num">1.5e3</span> + <span class="num">10n</span> + <span class="num">0xff</span>');
    expect(highlightLines('x1 + y')[0]).toBe('x1 + y');
  });

  test('svenska bokstäver i namn', () => {
    expect(highlightLines('const färg = 1')[0]).toBe('<span class="kw">const</span> färg = <span class="num">1</span>');
  });

  test('halvskriven kod ger rätt antal rader och samma text', () => {
    for (const code of ['', '"abc', '/* x', '`a ${', '/', 'x = /', '`a\nb ${ c\n}`', "'a\\'b'", 'a &&\n  b < c', '}}}', '`${`${1}`}`']) {
      const lines = highlightLines(code);
      expect(lines.length).toBe(code.split('\n').length);
      expect(lines.map(plain).join('\n')).toBe(code);
    }
  });
});
