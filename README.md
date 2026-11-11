# Kodvisare

Se hur din JavaScript körs, steg för steg, utan breakpoints.

Kodvisare kör ett av dina projekt, spelar in allt som händer och låter dig
bläddra fram och tillbaka i körningen efteråt.

## Starta

```bash
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
| `ui/views/` | Panelerna på skärmen |
| `test/` | Tester (`npm test`) och exempelprojekten |
