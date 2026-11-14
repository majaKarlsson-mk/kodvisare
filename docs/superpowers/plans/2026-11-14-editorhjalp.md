# Editorhjälp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatiska par, smart indrag, ångringsbara redigeringar och färgad kod i Skrivblocket (och tangentbeteendena i Klistra in kod).

**Architecture:** Två nya rena moduler i `ui/`: `editor.js` räknar ut vilken redigering en tangent ska ge (testbar utan webbläsare) och kopplar den till en textarea; `highlight.js` gör om kod till färgad html per rad. `scratch.js` ritar spegeln med färger och gör textarean genomskinlig.

**Tech Stack:** Vanlig JavaScript (ES-moduler), Vite, Vitest. Inga nya beroenden.

**Spec:** `docs/superpowers/specs/2026-11-14-editorhjalp-design.md`

## Global Constraints

- Inga nya beroenden, inget ramverk.
- Indragssteg: två mellanslag (`'  '`), som Tab i dag och `tab-size: 2`.
- Färgklasser: `kw`, `str`, `num`, `atom`, `com` (finns i `ui/style.css`).
- Nyckelord som kodvyn: Babels nyckelord plus `let async await of static get set from as yield`; atomer `true false null undefined NaN Infinity`.
- Kommentarer i koden och texter på svenska, som resten av projektet.

## Review Focus

- Svenskt Mac-tangentbord: `` ` `` är en död tangent (kommer via komposition, inte keydown) → måste ändå få sitt par. Test: `afterComposition` i Task 1.
- Cmd+/ på svenskt tangentbord är Cmd+Skift+7 → ska också växla kommentar. Test i Task 1.
- Enter på en rad med text (`  foo|`) ska behålla indraget; dagens kod tar bara med indrag när markören står efter blanksteg. Test i Task 1.
- Halvskriven kod (oavslutad sträng, kommentar, template) får inte färga resten av filen fel eller ge fel antal rader. Test i Task 2.
- `<`, `&` och `"` i koden ska escapas i spegeln, annars blir html fel. Test i Task 2.

---

### Task 1: Tangentbeteenden (`ui/editor.js`)

**Files:**
- Create: `ui/editor.js`
- Test: `test/editor.test.js`

**Interfaces:**
- Produces:
  - `editFor(state, key, opts?) → Edit | null` där `state = { value, start, end }`, `key = { key, shift, mod, code }`, `opts = { unit = '  ', comment = '//' }` och `Edit = { from, to, text, selStart, selEnd }`. `null` = låt webbläsaren göra det vanliga.
  - `afterComposition(state, data) → Edit | null` (tillståndet efter att tecknet redan satts in).
  - `enhanceEditor(textarea, opts?) → void`

- [ ] **Step 1: Skriv testerna** med en hjälpfunktion där `|` är markören och `‹…›` en markering:

| Före | Tangent | Efter |
|---|---|---|
| `\|` | `(` | `(\|)` |
| `\|foo` | `(` | `null` |
| `‹a›` | `"` | `"‹a›"` |
| `"\|"` | `"` | `""\|` |
| `don\|` | `'` | `null` |
| `f(\|)` | `)` | `f()\|` |
| `(\|)` | Backspace | `\|` |
| `    \|x` | Backspace | `  \|x` |
| `  if (x) {\|}` | Enter | `  if (x) {\n    \|\n  }` |
| `  foo\|` | Enter | `  foo\n  \|` |
| `    \|` | `}` | `  }\|` |
| `a\|` | Tab | `a  \|` |
| `‹a\nb›` | Tab | `‹  a\n  b›` |
| `‹a\nb\n›c` | Tab | `‹  a\n  b\n›c` (raden där markeringen slutar i kolumn 0 räknas inte) |
| `  a\|` | Skift+Tab | `a\|` |
| `‹a\n  b›` | Cmd+/ | `‹// a\n//   b›` |
| `// a\|` | Cmd+/ | `a\|` |
| `a\|` | Cmd+Skift+7 (`code: 'Digit7'`) | `// a\|` |
| `a\|` | Cmd+Enter | `null` |
| `` `\| `` (efter komposition) | `afterComposition(…, '`')` | `` `\|` `` |

- [ ] **Step 2:** `npx vitest run test/editor.test.js` → FAIL (modulen finns inte).
- [ ] **Step 3: Implementera `editFor` och `afterComposition`.** Regler:
  - Par stängs bara när nästa tecken är radslut, blanksteg eller ett av `)]};,.:`; citattecken stängs inte direkt efter en bokstav/siffra/`_`/`$`.
  - Överskrivning: sluttecken eller citattecken som redan står närmast efter markören → flytta förbi.
  - Enter: indrag = radens inledande blanksteg (fram till markören). Föregående tecken (före markören, blanksteg ignoreras) `{[(` → ett steg till; står matchande sluttecken direkt efter → det hamnar på egen rad med radens indrag.
  - Sluttecken `)]}` på en rad med bara blanksteg före markören → ta bort ett indragssteg först.
  - Backspace i ren indragning → till föregående jämna indragssteg.
  - Kommentar: `// ` sätts in vid minsta indraget bland icke-tomma rader; finns `//` på alla icke-tomma rader tas `// ` (eller `//`) bort. Markeringen täcker sedan hela raderna, utom när det bara var en markör (den flyttas med texten).
- [ ] **Step 4: Implementera `enhanceEditor`.** `keydown`: hoppa över `e.isComposing`; `mod = e.metaKey || e.ctrlKey`. Redigeringen görs med `setSelectionRange(from, to)` + `document.execCommand('insertText', false, text)` (eller `'delete'` för tom text) så att Cmd+Z fungerar; returnerar `execCommand` false används `setRangeText` + ett `input`-event. Tom redigering med `from === to` sätter bara markören. `compositionend` → `afterComposition`.
- [ ] **Step 5:** `npx vitest run test/editor.test.js` → PASS.
- [ ] **Step 6: Commit** `ui/editor.js test/editor.test.js` – "Editorn: automatiska par, indrag och kommentarer".

### Task 2: Färgning (`ui/highlight.js`)

**Files:**
- Create: `ui/highlight.js`
- Test: `test/highlight.test.js`

**Interfaces:**
- Consumes: `esc` från `ui/dom.js`.
- Produces: `highlightLines(code: string) → string[]`, html per rad; spann går aldrig över radbrytningar; `result.length === code.split('\n').length` alltid.

- [ ] **Step 1: Skriv testerna:**
  - `highlightLines('const x = 1;')` → `['<span class="kw">const</span> x = <span class="num">1</span>;']`
  - `'"<a>"'` → `['<span class="str">&quot;&lt;a&gt;&quot;</span>']`
  - `'/* a\nb */ x'` → `['<span class="com">/* a</span>', '<span class="com">b */</span> x']`
  - `'"abc\nlet y'` → rad 2 är `'<span class="kw">let</span> y'`
  - `` '`a ${b + 1} c`' `` → innehåller `<span class="num">1</span>` och `<span class="str">` för `` `a `` respektive `` c` ``
  - `'a / b / c'` innehåller inte `class="str"`; `'x = /ab+/g'` innehåller `<span class="str">/ab+/g</span>`
  - `'map.get(1)'` innehåller inte `class="kw"`; `'x = null'` innehåller `<span class="atom">null</span>`
  - `''` → `['']`; för en lista halvskrivna snuttar (`'"abc'`, `'/* x'`, `` '`a ${' ``, `'/'`) är längden lika med antalet rader och resultatet utan taggar (taggar borttagna, entiteter avkodade) är lika med koden.
- [ ] **Step 2:** `npx vitest run test/highlight.test.js` → FAIL.
- [ ] **Step 3: Implementera** en tokeniserare i ett svep: kommentarer, strängar (oavslutad slutar vid radslut), template literals med en stack för `${ … }` (räkna `{`/`}` per nivå), tal, identifierare (ord direkt efter `.` eller `?.` färgas inte), och regex när ett uttryck väntas (föregående signifikanta token är inte ett värde: identifierare som inte är nyckelord, tal, sträng, `)`, `]`, `}`). En `/` vars regex inte slutar på samma rad är division.
- [ ] **Step 4:** `npx vitest run test/highlight.test.js` → PASS.
- [ ] **Step 5: Commit** `ui/highlight.js test/highlight.test.js` – "Färgning av kod medan man skriver".

### Task 3: Koppla in i Skrivblocket och Klistra in kod

**Files:**
- Modify: `ui/views/scratch.js` (spegeln, `showCaret`, keydown-hanteringen)
- Modify: `ui/main.js` (klistra in-rutorna)
- Modify: `ui/style.css` (`.sb-mirror .tx`, `#sb-code`)
- Modify: `README.md` (avsnittet Skrivblock)

**Interfaces:**
- Consumes: `enhanceEditor(textarea, { unit, comment })` (Task 1), `highlightLines(code)` (Task 2).

- [ ] **Step 1:** `drawMirror` fyller varje `.tx` med html från `highlightLines(ta.value)`. `showCaret` hittar textnoden för kolumnen genom att gå igenom textnoderna i `.tx` (raden består nu av flera spann).
- [ ] **Step 2:** Ta bort Tab- och Enter-grenarna i `scratch.js` keydown (Cmd+Enter blir kvar) och anropa `enhanceEditor(ta)`. I `main.js`: `enhanceEditor(pasteCode)` och `enhanceEditor(pasteHtml, { comment: null })`.
- [ ] **Step 3:** CSS: `.sb-mirror .tx { color: var(--text) }`, `#sb-code { color: transparent; caret-color: var(--text) }`, `#sb-code::selection { color: transparent; background: <markeringsfärg som syns i ljust och mörkt läge> }`.
- [ ] **Step 4:** `npm test` → alla tester passerar.
- [ ] **Step 5: Kontroll i webbläsaren** (`npm start`, öppna Skrivblock): koden är färgad, markören står där texten står även på långa rader, `(`/`"`/`{`+Enter/`}`/Tab/Skift+Tab/Cmd+/ ger det som står i Task 1, Cmd+Z ångrar ett steg i taget, värdena bredvid raderna syns som förut, och Klistra in kod får paren.
- [ ] **Step 6:** README: en kort mening i avsnittet Skrivblock om paren, indraget, Cmd+/ (Cmd+Skift+7 på svenskt tangentbord) och färgerna.
- [ ] **Step 7: Commit** – "Skrivblocket: färgad kod och editorhjälp".
