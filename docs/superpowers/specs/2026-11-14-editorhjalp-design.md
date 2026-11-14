# Editorhjälp: automatiska par, indrag och färgad kod

## Varför

Skrivblocket och Klistra in kod ska kännas mer som VS Code när man skriver:
citattecken och parenteser stängs av sig själva, indraget sköter sig vid ny
rad, och koden är färgad medan man skriver. Målet är att det ska gå snabbare
att prova kod och att färre fel ska bero på en glömd `)` eller `"`.

## Mål

- Automatiska par: `(` `[` `{` `"` `'` `` ` `` sätter in sluttecknet och lägger
  markören emellan. Skriver man sluttecknet själv hoppar markören förbi det.
  Citattecken stängs inte direkt efter en bokstav eller siffra (`don't`).
- Markerad text plus citattecken/parentes omsluter markeringen.
- Backsteg mellan ett tomt par tar bort båda tecknen.
- Enter: behåller indraget, lägger till ett steg efter `{` `[` `(`, och mellan
  `{}` hamnar `}` på en egen rad.
- `}` `]` `)` som skrivs på en rad med bara indrag flyttar ut ett steg.
- Tab/Skift+Tab: indrag in/ut (flera rader om markeringen spänner över flera),
  Cmd+/ växlar `// ` på markerade rader.
- Allt går att ångra med Cmd+Z (ändringar görs med `execCommand('insertText')`,
  som webbläsaren lägger i sin ångra-historik; `setRangeText` gör inte det).
- Färgad kod i Skrivblocket, med samma klasser och färger som kodvyn
  (`kw`, `str`, `num`, `atom`, `com`).

## Utanför

- Ingen byte till CodeMirror/Monaco.
- Ingen formatering med Prettier.
- Ingen färgning i Klistra in kod-rutan (den är en vanlig textarea utan
  spegellager); den får bara tangentbeteendena.

## Tillvägagångssätt

1. **Bygga in i textarean som finns (valt).** Liten egen kod, inga nya beroenden,
   värdena bredvid raderna och radnumren fungerar som i dag.
2. **CodeMirror 6.** Ger allt detta och mer, men spegeln med värden och radnummer
   måste byggas om som CodeMirror-dekorationer, och ett beroende tillkommer.
3. **Monaco (VS Codes editor).** Tung, svår att kombinera med värdena bredvid raderna.

Maja valde 1 och bad om färgad kod också; färgningen görs i samma spegellager.

## Hur

- `ui/editor.js`: `enhanceEditor(textarea)` lägger till tangentbeteendena. De rena
  textberäkningarna (vad som ska sättas in var) ligger i funktioner som går att
  testa utan webbläsare.
- `ui/highlight.js`: `highlightLines(code)` delar koden i token och returnerar html
  per rad. Den måste tåla halvskriven kod (oavslutad sträng, kommentar eller
  template literal) och spänna över flera rader (`/* */`, template literals).
  Regex-literaler känns igen utifrån föregående token.
- `ui/views/scratch.js`: spegelns `.tx` fylls med färgad html i stället för
  ren text; textarean får genomskinlig text och synlig markör (`caret-color`).
  Den gamla Enter/Tab-hanteringen ersätts av `enhanceEditor`.
- `ui/main.js`: `enhanceEditor` på `#paste-code` (och `#paste-html` får bara
  Tab/indrag, inga JS-specifika regler behövs där – samma funktion duger).
- Tester i `test/editor.test.js` och `test/highlight.test.js`.

## Kvar åt byggaren

Exakta regler för när ett citattecken räknas som "efter ett ord", och hur
regex-gissningen fungerar i kantfall.
