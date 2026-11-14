// Färgar JavaScript medan man skriver (skrivblocket). Kodvyn får sina färger från
// Babel på servern, men här måste det gå snabbt och tåla halvskriven kod, så det
// är en enkel genomgång tecken för tecken. Klasserna är desamma som i kodvyn.
import { esc } from './dom.js';

const KEYWORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends finally for function if import in ' +
    'instanceof new return super switch this throw try typeof var void while with ' +
    'let async await of static get set from as yield'
  ).split(' '),
);
const ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const VALUE_WORDS = new Set(['this', 'super']); // nyckelord som är värden: / efter dem är division

const WORD = /[\p{L}\p{Nl}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;
const FLAGS = /[a-z]*/y;

const match = (re, code, at) => {
  re.lastIndex = at;
  return re.exec(code)?.[0] ?? '';
};

// Svarar med html för varje rad. Ett färgat stycke delas vid radbrytningar,
// så att varje rad kan ritas för sig.
export function highlightLines(code) {
  const lines = [''];
  let plain = '';
  const flush = () => {
    if (plain) emit(plain, null, true);
    plain = '';
  };
  function emit(text, cls, raw = false) {
    if (!raw) flush();
    text.split('\n').forEach((part, k) => {
      if (k) lines.push('');
      if (part) lines[lines.length - 1] += cls ? '<span class="' + cls + '">' + esc(part) + '</span>' : esc(part);
    });
  }

  const n = code.length;
  const tpl = []; // ett djup per öppet ${ … }, för att veta vilken } som avslutar uttrycket
  let i = 0;
  let value = false; // står det ett värde före? Då är / division, annars början på ett regex
  let prevDot = false; // föregående tecken var en punkt i a.b eller a?.b
  let word = '';

  // Läser en template literal från i (efter ` eller den } som avslutar ett ${ … })
  function template(from) {
    let j = from;
    while (j < n) {
      if (code[j] === '\\') j += 2;
      else if (code[j] === '`') {
        emit(code.slice(from - (code[from - 1] === '`' ? 1 : 0), j + 1), 'str');
        value = true;
        return j + 1;
      } else if (code[j] === '$' && code[j + 1] === '{') {
        emit(code.slice(from - (code[from - 1] === '`' ? 1 : 0), j), 'str');
        plain += '${';
        tpl.push(0);
        value = false;
        return j + 2;
      } else j++;
    }
    emit(code.slice(from - (code[from - 1] === '`' ? 1 : 0)), 'str');
    return n;
  }

  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    const wasDot = prevDot;
    prevDot = false;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      plain += c;
      i++;
      prevDot = wasDot;
    } else if (c === '/' && c2 === '/') {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      emit(code.slice(i, stop), 'com');
      i = stop;
    } else if (c === '/' && c2 === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      emit(code.slice(i, stop), 'com');
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' && code[j + 1] !== '\n' ? 2 : 1;
      const stop = Math.min(n, code[j] === c ? j + 1 : j);
      emit(code.slice(i, stop), 'str');
      i = stop;
      value = true;
    } else if (c === '`') {
      i = template(i + 1);
    } else if (c === '}' && tpl.length && tpl[tpl.length - 1] === 0) {
      tpl.pop();
      plain += '}';
      i = template(i + 1);
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(c2 ?? ''))) {
      const num = match(NUMBER, code, i) || c;
      emit(num, 'num');
      i += num.length;
      value = true;
    } else if ((word = match(WORD, code, i))) {
      // Namn efter en punkt (map.get, promise.then) är egenskaper, inte nyckelord
      if (!wasDot && KEYWORDS.has(word)) {
        emit(word, 'kw');
        value = VALUE_WORDS.has(word);
      } else if (!wasDot && ATOMS.has(word)) {
        emit(word, 'atom');
        value = true;
      } else {
        plain += word;
        value = true;
      }
      i += word.length;
    } else if (c === '/' && !value) {
      // Ett regex slutar på samma rad; annars var det en division
      let j = i + 1;
      let cls = false;
      while (j < n && code[j] !== '\n' && (code[j] !== '/' || cls)) {
        if (code[j] === '\\') j++;
        else if (code[j] === '[') cls = true;
        else if (code[j] === ']') cls = false;
        j++;
      }
      if (code[j] === '/') {
        const end = j + 1 + match(FLAGS, code, j + 1).length;
        emit(code.slice(i, end), 'str');
        i = end;
        value = true;
      } else {
        plain += c;
        i++;
      }
    } else {
      if (tpl.length && c === '{') tpl[tpl.length - 1]++;
      else if (tpl.length && c === '}') tpl[tpl.length - 1]--;
      plain += c;
      value = c === ')' || c === ']' || c === '}';
      prevDot = c === '.' && code[i - 1] !== '.';
      i++;
    }
  }
  flush();
  return lines;
}
