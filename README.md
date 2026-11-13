# Kodvisare

Se hur din JavaScript körs, steg för steg, utan breakpoints.

Kodvisare kör ett av dina projekt, spelar in allt som händer och låter dig
bläddra fram och tillbaka i körningen efteråt. I stället för att pausa koden
och gissa var du ska sätta en breakpoint kan du dra i en tidslinje och se
exakt vilken rad som kördes, vilka värden variablerna hade och vilka
funktioner som ledde dit.

**I korthet**

- Spelar in varje steg i en körning: variabler, funktionsanrop, `await`,
  klick, timers, fetch och fel.
- Spolar fram och tillbaka i tiden, och visar värdena bredvid kodraderna.
- Pekar bakåt från en krasch till raden där det felaktiga värdet faktiskt uppstod.
- Har ett skrivblock där kod körs medan du skriver, som en konsol fast med historik.
- Ändrar aldrig dina filer. Koden skrivs om på vägen till webbläsaren.

**Byggt med** JavaScript (ES-moduler), Node.js, Vite, Babel (parser, traverse,
generator) och Vitest. Gränssnittet är skrivet utan ramverk.

## Starta

Du behöver [Node.js](https://nodejs.org/) (testat med version 24).

```bash
git clone https://github.com/majakarlsson68gmailcom/kodvisare.git
cd kodvisare
npm install
npm start
```

Verktyget öppnas i webbläsaren och letar efter projekt (mappar med en
`index.html`) i mappen ovanför `kodvisare`. Vill du leta någon annanstans:

```bash
npm start -- ../en/annan/mapp
```

Överst i listan finns två exempel att öva på: ett med en bugg där felet
uppstår tidigare än där det kraschar, och ett som visar i vilken ordning
asynkron kod körs.

## Klistra in kod

Vill du bara prova en kodsnutt? Klicka på projektnamnet uppe till vänster och
välj fliken **Klistra in kod**. Klistra in JavaScript och tryck på Kör koden
(eller Cmd + Enter). Behöver koden knappar eller andra element kan du lägga
till HTML under "HTML till sidan". Det du klistrade in senast finns kvar nästa gång.

## Skrivblock

Vill du bara testa lite kod, som i konsolen? Klicka på projektnamnet uppe till
vänster och välj fliken **Skrivblock**. Editorn hamnar till vänster, och koden
körs av sig själv en halv sekund efter att du slutat skriva, så snart den går
att tolka (halvskriven kod väntar). Cmd + Enter eller knappen Kör kör direkt,
även kod med fel i, och kryssrutan stänger av automatiken. Under editorn syns det som
skrivs med console.log, fel, och värdet av varje uttryck som står på en egen
rad, som `tal.map((t) => t * 2);` → `[2, 4, 6]`. Värdena syns också bredvid
raderna, och koden i mitten och panelerna till höger fungerar som vanligt, så
du kan stega igenom körningen. Koden sparas i mappen `.skrivblock` och finns
kvar nästa gång.

## Så använder du det

- **Din sida** till vänster är ditt riktiga projekt. Klicka och skriv som vanligt.
- **Tidslinjen** längst ner: dra i den, eller stega med ← och →.
  Skift + ← → hoppar över funktionsanrop. Prickarna är klick, timers, fetch och fel.
- **Koden** visar raden som körs och värdena bredvid raderna där de sattes.
  Klicka på ett radnummer för att hoppa till nästa gång raden körs.
- **Hovra över ett funktionsnamn** för att se var funktionen anropades och gå dit.
- **Variabler** visar allt koden kan se just då. Klicka på ◉ för att bevaka en
  variabel och se hela dess historik under **Bevakning**.
- **Anropskedja** visar vilka funktioner som ledde fram till raden du står på.
- **Felrutan** dyker upp när koden kraschar och pekar bakåt till raden där
  det felaktiga värdet uppstod.
- **Dra i linjerna** mellan panelerna för att ändra storlek, som i DevTools:
  bredden på Din sida och sidopanelen, och höjden på Variabler, Bevakning och
  Anropskedja. Dubbelklicka på en linje för att återställa. Storlekarna sparas.

Dina filer ändras aldrig. Koden skrivs om på vägen till webbläsaren, inte på disk.
När du sparar en fil i din editor laddas sidan om och inspelningen börjar om.

## Bra att veta

- Fungerar med vanlig JavaScript: `<script src>`, `type="module"` och Vite-projekt.
  Inte React, TypeScript eller kod som körs i Node.
- Objekt och arrayer visas tre nivåer djupt och med högst 50 delar.
- En loop som kör mer än 200 000 steg utan paus stoppas, och räknas som en
  trolig oändlig loop. Av en lång inspelning sparas de senaste 200 000 stegen.

## Hur det fungerar

1. **Omskrivning.** När sidan hämtar en JavaScript-fil går den genom ett
   Vite-plugin. Babel läser in koden som ett syntaxträd och lägger till små
   anrop före varje sats och efter varje tilldelning, ungefär så här:

   ```js
   const typ = data.type;
   // blir
   __kv.s(ram, 1200004);       // nu körs satsen på den här platsen
   const typ = data.type;
   __kv.v(ram, "typ", typ);    // typ fick det här värdet
   ```

2. **Inspelning.** Ett litet skript i sidan tar emot anropen och gör dem till
   en lång lista med händelser: steg, värden, funktioner som startar och
   slutar, fel och `console.log`. Värden kopieras när de sätts, så att de
   senare går att visa som de var just då. Asynkron kod (klick, timers,
   promises och `await`) får en egen markering så att man kan följa vad som
   startade vad.

3. **Uppspelning.** Verktyget tar emot listan och bygger upp en modell som
   kan svara på frågor som "vad var `x` vid steg 4 812?" eller "var anropades
   den här funktionen?". Panelerna läser bara från den modellen, så det går
   lika snabbt att hoppa bakåt som framåt.

## Hur det är byggt

| Mapp | Vad den gör |
|---|---|
| `server/instrument.js` | Skriver om koden så att den rapporterar varje steg (Babel) |
| `server/plugin.js` | Vite-plugin som kör omskrivningen när sidan hämtar filerna |
| `server/index.js` | Startar verktyget och projektets sida |
| `runtime/` | Körs inne i din sida: samlar händelser och skickar dem till verktyget |
| `ui/store.js` | Håller inspelningen och svarar på "vad var X vid steg N?" |
| `ui/provenance.js` | Letar bakåt efter var ett felaktigt värde uppstod |
| `ui/callsites.js` | Hittar var en funktion anropas |
| `ui/layout.js` | Dragbara avdelare mellan panelerna |
| `ui/inline.js` | Värdena som visas bredvid raderna (kodvyn och skrivblocket) |
| `ui/views/` | Panelerna på skärmen (`scratch.js` är skrivblocket) |
| `test/` | Tester (`npm test`) och exempelprojekten |
