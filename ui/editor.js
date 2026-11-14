// Editorhjälp för en vanlig textarea, ungefär som i VS Code: parenteser och
// citattecken stängs av sig själva, indraget följer med vid ny rad, Tab flyttar
// rader och Cmd+/ kommenterar.
//
// editFor räknar bara ut vad en tangent ska göra och rör inte sidan, så att den
// går att testa. enhanceEditor kopplar den till en textarea.

const OPEN = { '(': ')', '[': ']', '{': '}' };
const QUOTES = new Set(['"', "'", '`']);
const CLOSERS = new Set([')', ']', '}']);
const CLOSE_BEFORE = /^(?:$|[\s)\]};,.:])/; // par stängs bara framför de här tecknen
const WORD = /[\p{L}\p{N}_$]/u;

const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (v, i) => {
  const n = v.indexOf('\n', i);
  return n < 0 ? v.length : n;
};

// Står markören inuti en sträng med det här citattecknet? (Udda antal före den.)
function insideString(v, at, q) {
  const from = q === '`' ? 0 : lineStart(v, at);
  let n = 0;
  for (let i = from; i < at; i++) {
    if (v[i] === '\\') i++;
    else if (v[i] === q) n++;
  }
  return n % 2 === 1;
}

const put = (from, to, text, sel = from + text.length, selEnd = sel) => ({ from, to, text, selStart: sel, selEnd });
const moveTo = (pos, end = pos) => put(pos, pos, '', pos, end);

// Raderna som markeringen rör. En markering som slutar först i en rad räknar inte den raden.
function touchedLines(v, start, end) {
  const from = lineStart(v, start);
  const last = end > start && v[end - 1] === '\n' ? end - 1 : end;
  return { from, to: lineEnd(v, last), endsAtNewline: last !== end };
}

// Byter ut raderna och markerar dem, eller flyttar markören med texten om det inte fanns någon markering.
function replaceLines(state, block, lines, shiftAt) {
  const { start, end } = state;
  const text = lines.join('\n');
  if (start === end) {
    const [col, delta] = shiftAt;
    const pos = start - block.from >= col ? Math.max(block.from + col, start + delta) : start;
    return put(block.from, block.to, text, pos);
  }
  const to = block.from + text.length;
  return put(block.from, block.to, text, block.from, to + (block.endsAtNewline ? 1 : 0));
}

function indentLines(state, unit) {
  const block = touchedLines(state.value, state.start, state.end);
  const lines = state.value.slice(block.from, block.to).split('\n').map((l) => (l ? unit + l : l));
  return replaceLines(state, block, lines, [0, unit.length]);
}

function outdentLines(state, unit) {
  const { value: v, start, end } = state;
  const block = touchedLines(v, start, end);
  const old = v.slice(block.from, block.to).split('\n');
  const removed = old.map((l) => (l[0] === '\t' ? 1 : /^ */.exec(l)[0].length > unit.length ? unit.length : /^ */.exec(l)[0].length));
  if (!removed.some(Boolean)) return moveTo(start, end);
  const lines = old.map((l, i) => l.slice(removed[i]));
  if (start !== end && !v.slice(start, end).includes('\n')) {
    // Markering på en rad: behåll den, flyttad med texten
    const r = removed[0];
    return put(block.from, block.to, lines.join('\n'), Math.max(block.from, start - r), Math.max(block.from, end - r));
  }
  return replaceLines(state, block, lines, [0, -removed[0]]);
}

function toggleComment(state, mark) {
  const { value: v, start, end } = state;
  const block = touchedLines(v, start, end);
  const old = v.slice(block.from, block.to).split('\n');
  const filled = old.filter((l) => l.trim());
  if (!filled.length) return moveTo(start, end);
  const indentOf = (l) => /^\s*/.exec(l)[0].length;
  const cursorLine = old[0];
  if (filled.every((l) => l.trimStart().startsWith(mark))) {
    const lines = old.map((l) => {
      const at = indentOf(l);
      if (!l.slice(at).startsWith(mark)) return l;
      const cut = mark.length + (l[at + mark.length] === ' ' ? 1 : 0);
      return l.slice(0, at) + l.slice(at + cut);
    });
    const at = indentOf(cursorLine);
    return replaceLines(state, block, lines, [at, lines[0].length - cursorLine.length]);
  }
  const min = Math.min(...filled.map(indentOf));
  const lines = old.map((l) => (l.trim() ? l.slice(0, min) + mark + ' ' + l.slice(min) : l));
  return replaceLines(state, block, lines, [min, mark.length + 1]);
}

function enter(state, unit) {
  const { value: v, start, end } = state;
  const ls = lineStart(v, start);
  const before = v.slice(ls, start);
  const indent = /^[ \t]*/.exec(before)[0];
  const opener = before.trimEnd().slice(-1);
  if (OPEN[opener]) {
    const inner = indent + unit;
    const after = v.slice(end, lineEnd(v, end));
    const rest = after.trimStart();
    if (rest[0] === OPEN[opener]) {
      // Mellan {} hamnar } på en egen rad
      const gap = after.length - rest.length;
      return put(start, end + gap, '\n' + inner + '\n' + indent, start + 1 + inner.length);
    }
    return put(start, end, '\n' + inner);
  }
  if (!indent) return null;
  return put(start, end, '\n' + indent);
}

function backspace(state, unit) {
  const { value: v, start } = state;
  const prev = v[start - 1];
  const next = v[start];
  if ((OPEN[prev] && next === OPEN[prev]) || (QUOTES.has(prev) && next === prev)) return put(start - 1, start + 1, '', start - 1);
  const before = v.slice(lineStart(v, start), start);
  if (before && /^ +$/.test(before) && unit[0] === ' ') {
    const keep = Math.floor((before.length - 1) / unit.length) * unit.length;
    return put(start - before.length + keep, start, '');
  }
  return null;
}

// state: { value, start, end }, key: { key, shift, mod, code }
// Svarar med { from, to, text, selStart, selEnd } eller null om webbläsaren ska sköta tangenten.
export function editFor(state, { key, shift, mod, code }, { unit = '  ', comment = '//' } = {}) {
  const { value: v, start, end } = state;
  const sel = start !== end;
  const next = v[end] ?? '';
  const prev = v[start - 1] ?? '';

  if (mod) {
    // Cmd+/ (på svenskt tangentbord Cmd+Skift+7)
    if (comment && (key === '/' || (shift && code === 'Digit7'))) return toggleComment(state, comment);
    return null;
  }
  if (key === 'Tab') {
    if (shift) return outdentLines(state, unit);
    return sel && v.slice(start, end).includes('\n') ? indentLines(state, unit) : put(start, end, unit);
  }
  if (key === 'Enter') return shift ? null : enter(state, unit);
  if (key === 'Backspace') return sel ? null : backspace(state, unit);

  if (OPEN[key]) {
    if (sel) return put(start, end, key + v.slice(start, end) + OPEN[key], start + 1, end + 1);
    return CLOSE_BEFORE.test(next) ? put(start, end, key + OPEN[key], start + 1) : null;
  }
  if (QUOTES.has(key)) {
    if (sel) return put(start, end, key + v.slice(start, end) + key, start + 1, end + 1);
    if (next === key) return moveTo(start + 1);
    if (WORD.test(prev) || insideString(v, start, key)) return null;
    return CLOSE_BEFORE.test(next) ? put(start, end, key + key, start + 1) : null;
  }
  if (CLOSERS.has(key) && !sel) {
    if (next === key) return moveTo(start + 1);
    const before = v.slice(lineStart(v, start), start);
    if (before && /^ +$/.test(before)) {
      const keep = Math.floor((before.length - 1) / unit.length) * unit.length;
      return put(start - before.length, end, ' '.repeat(keep) + key);
    }
  }
  return null;
}

// Tecken som kom via en död tangent (` på svenskt Mac-tangentbord) syns inte i
// keydown. När tecknet redan står i texten sätts slutcitattecknet in efteråt.
export function afterComposition(state, data) {
  const { value: v, start, end } = state;
  if (start !== end || !QUOTES.has(data) || v[start - 1] !== data) return null;
  if (WORD.test(v[start - 2] ?? '') || insideString(v, start - 1, data)) return null;
  return CLOSE_BEFORE.test(v[start] ?? '') ? put(start, start, data, start) : null;
}

// Gör ändringen så att den hamnar i webbläsarens ångra-historik (Cmd+Z).
function applyEdit(ta, { from, to, text, selStart, selEnd }) {
  if (from !== to || text) {
    ta.setSelectionRange(from, to);
    const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    if (!ok) {
      ta.setRangeText(text, from, to);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  ta.setSelectionRange(selStart, selEnd);
}

// opts: { unit: indragssteg, comment: kommentarstecken eller null för att stänga av Cmd+/ }
export function enhanceEditor(ta, opts = {}) {
  const state = () => ({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    if (e.altKey && e.key.length !== 1) return; // Alt+Backsteg tar bort ett ord som vanligt
    const edit = editFor(state(), { key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, code: e.code }, opts);
    if (!edit) return;
    e.preventDefault();
    applyEdit(ta, edit);
  });
  ta.addEventListener('compositionend', (e) => {
    // Vänta tills tecknet har hamnat i texten (Safari skickar compositionend före input)
    setTimeout(() => {
      const edit = afterComposition(state(), e.data);
      if (edit) applyEdit(ta, edit);
    });
  });
}
