// Skrivblocket: skriv JavaScript till vänster och se resultatet medan du skriver.
// Koden sparas på servern (.skrivblock/kod.js) och körs som ett vanligt projekt;
// värdena bredvid raderna och utdatan hämtas ur samma inspelning som resten av verktyget.
import { $, el } from '../dom.js';
import { short } from '../format.js';
import { inlineHtml, inlineValues } from '../inline.js';
import { enhanceEditor } from '../editor.js';
import { highlightLines } from '../highlight.js';

export const SCRATCH_NAME = 'Skrivblock';
const DEBOUNCE = 500; // ms efter senaste tangenttryckningen

export function createScratchView(app) {
  const { store } = app;
  const main = $('#main');
  const section = $('#scratch');
  const edit = $('#scratch .sb-edit');
  const mirror = $('#scratch .sb-mirror');
  const ta = $('#sb-code');
  const out = $('#sb-output .body');
  const status = $('#sb-status');
  const auto = $('#sb-auto');

  let active = false;
  let loaded = false;
  let lastSent = null; // koden som senast skickades till servern
  let pending = false; // väntar på att sidan ska ladda om med ny kod
  let healed = false; // har vi redan kört om en gång för den här omladdningen?
  let incomplete = false; // koden gick inte att tolka, så den väntar på fler tecken
  let timer = 0;
  let lineEls = [];
  let drawn = null;

  // ----- editorn: en genomskinlig textarea ovanpå en spegel med färgad kod, radnummer och värden -----

  function drawMirror() {
    if (ta.value === drawn) return;
    drawn = ta.value;
    lineEls = highlightLines(ta.value).map((html, i) => {
      const tx = el('span', { class: 'tx' });
      tx.innerHTML = html;
      return el('div', { class: 'ln', 'data-line': i + 1 }, el('span', { class: 'no' }, String(i + 1)), tx, el('span', { class: 'iv' }));
    });
    mirror.replaceChildren(...lineEls);
    // Textarean ska täcka hela spegeln, så att det är rutan runt om som rullar
    ta.style.height = mirror.offsetHeight + 'px';
    ta.style.width = Math.max(mirror.scrollWidth, edit.clientWidth) + 'px';
  }

  function scheduleRun() {
    clearTimeout(timer);
    if (auto.checked) timer = setTimeout(() => runAndShow(false), DEBOUNCE);
  }

  // Raden består av flera färgade spann: hitta textnoden och platsen i den för en kolumn
  function textPoint(tx, col) {
    const walk = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      if (col <= node.length) return { node, offset: col };
      col -= node.length;
      last = node;
    }
    return last && { node: last, offset: last.length };
  }

  // Textarean rullar inte själv (den är lika stor som all text), så rutan runt om
  // måste följa med markören.
  function showCaret() {
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const top = 6 + (line - 1) * 20; // samma padding och radhöjd som i stilmallen
    if (top < edit.scrollTop) edit.scrollTop = top;
    else if (top + 20 > edit.scrollTop + edit.clientHeight) edit.scrollTop = top + 20 - edit.clientHeight;
    const col = before.length - before.lastIndexOf('\n') - 1;
    const tx = lineEls[line - 1]?.children[1];
    const at = tx && textPoint(tx, col);
    if (at) {
      const range = document.createRange();
      range.setStart(at.node, at.offset);
      range.collapse(true);
      const x = range.getBoundingClientRect().left - edit.getBoundingClientRect().left + edit.scrollLeft;
      if (x < edit.scrollLeft + 56) edit.scrollLeft = Math.max(0, x - 56);
      else if (x > edit.scrollLeft + edit.clientWidth - 24) edit.scrollLeft = x + 24 - edit.clientWidth;
    }
  }

  ta.addEventListener('input', () => {
    drawMirror();
    render();
    showCaret();
    scheduleRun();
  });
  ta.addEventListener('keyup', showCaret);
  ta.addEventListener('click', showCaret);

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runAndShow(true);
    }
  });
  // Par, indrag, Tab och Cmd+/ (se editor.js)
  enhanceEditor(ta);

  $('#sb-run').addEventListener('click', () => runAndShow(true));
  auto.addEventListener('change', () => auto.checked && scheduleRun());

  // ----- köra -----

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const last = await fetch('/api/scratch').then((r) => r.json());
      if (!ta.value) ta.value = last.code;
    } catch {}
    drawMirror();
  }

  // Går koden att tolka? Halvskriven kod ska inte köras av sig själv och fylla
  // utdatan med syntaxfel. (await på toppnivå är tillåtet, därför async-omslaget.)
  function parses(code) {
    try {
      new Function('return (async () => {\n' + code + '\n})');
      return true;
    } catch {
      return false;
    }
  }

  // Skickar koden till servern. Svarar med { name, url, opened } eller null om den inte kördes.
  async function run(force) {
    clearTimeout(timer);
    const code = ta.value;
    if (!force && code === lastSent) return null;
    if (!force && !parses(code)) {
      incomplete = true;
      render();
      return null;
    }
    incomplete = false;
    lastSent = code;
    pending = true;
    healed = false;
    mirror.classList.add('pending');
    render();
    try {
      const res = await fetch('/api/scratch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } catch (err) {
      pending = false;
      mirror.classList.remove('pending');
      app.say('Kunde inte köra koden: ' + err.message);
      render();
      return null;
    }
  }

  async function runAndShow(force) {
    const data = await run(force);
    if (!data) return;
    // Första gången öppnas skrivblocket som projekt; sedan räcker det att ladda om sidan
    if (data.opened) app.attach(data);
    else app.reload();
  }

  // Öppna skrivblocket från projektväljaren
  async function open() {
    await load();
    const data = await run(true);
    if (data) app.attach(data);
  }

  function setActive(on) {
    active = on;
    main.classList.toggle('scratch', on);
    section.hidden = !on;
    if (on) {
      load().then(() => ta.focus());
    }
  }

  // Sidan har laddats om: inspelningen börjar om
  function onReset() {
    pending = false;
    mirror.classList.remove('pending');
  }

  // Serverns fakta om filerna har kommit. Stämmer inte koden som kördes med det som
  // står i editorn (skrivningen och omladdningen hann korsa varandra) körs den om.
  function onFiles() {
    if (!active || pending || healed) return;
    const file = scratchFile();
    if (file && file.source !== ta.value && ta.value === lastSent) {
      healed = true;
      runAndShow(true);
    }
  }

  // ----- visa -----

  function scratchFile() {
    for (const f of store.files.values()) if (f.rel === 'kod.js') return f;
    return null;
  }

  function render() {
    if (!active) return;
    drawMirror();
    if (app.hold) return; // den gamla vyn står kvar tills den nya körningen har gett något
    for (const le of lineEls) {
      le.className = 'ln';
      le.lastChild.textContent = '';
    }
    const file = scratchFile();
    if (file) {
      // Värdena hör till koden som kördes. Rader som har ändrats sedan dess får inga.
      const ran = file.source.split('\n');
      const now = ta.value.split('\n');
      for (const [line, items] of inlineValues(store, file.id, app.n)) {
        const le = lineEls[line - 1];
        if (le && now[line - 1] === ran[line - 1]) le.lastChild.innerHTML = inlineHtml(items);
      }
      const step = store.step(app.n);
      const at = step && store.loc(step.L);
      if (at && at.file.id === file.id) lineEls[at.line - 1]?.classList.add('cur');
      for (const { ex } of app.errors()) {
        if (ex.file && ex.file.id === file.id && ex.step <= app.n) lineEls[ex.line - 1]?.classList.add('err');
      }
    }
    renderOutput();
    status.textContent = pending ? 'Kör …' : incomplete ? 'Skriver …' : app.problems.length ? 'Koden går inte att läsa' : store.count ? store.count.toLocaleString('sv') + ' steg' : '';
    status.classList.toggle('warn', !pending && !incomplete && app.problems.length > 0);
  }

  // Utdata: console.log, resultat av uttryck och fel, i den ordning de hände fram till valt steg
  function renderOutput() {
    const iEnd = app.n >= 0 ? store.endOf(app.n) : -1;
    const rows = [];
    for (const p of app.problems) rows.push({ i: -1, kind: 'problem', text: p.message });
    for (const l of store.logs) {
      if (l.i <= iEnd) rows.push({ i: l.i, kind: l.level, step: l.step, text: l.args.map((a) => (typeof a === 'string' ? a : short(a, 120))).join(' ') });
    }
    for (const o of store.outputs) {
      if (o.i <= iEnd) rows.push({ i: o.i, kind: 'out', step: o.step, line: store.loc(o.L)?.line, text: '→ ' + short(o.snap, 120) });
    }
    for (const { err, ex } of app.errors()) {
      if (err.i <= iEnd) rows.push({ i: err.i, kind: 'err', step: ex.step, line: ex.line, text: ex.title + (ex.message ? ': ' + ex.message : '') });
    }
    rows.sort((a, b) => a.i - b.i);
    if (!rows.length) {
      const hint = pending ? 'Kör …' : ta.value.trim() ? 'Inget att visa än. Skriv ett uttryck på en egen rad, eller använd console.log.' : 'Skriv lite JavaScript ovanför, så körs det medan du skriver.';
      out.replaceChildren(el('p', { class: 'hint' }, hint));
      return;
    }
    out.replaceChildren(
      ...rows.slice(-200).map((r) =>
        el(
          'button',
          { type: 'button', class: 'rowbtn sb-row ' + r.kind + (r.step != null && r.step === app.n ? ' now' : ''), onclick: r.step != null ? () => app.go(r.step) : null },
          r.line ? el('span', { class: 'where' }, 'rad ' + r.line) : null,
          el('span', { class: 'what' }, r.text),
        ),
      ),
    );
  }

  return { render, setActive, open, onReset, onFiles, active: () => active };
}
