import { skriv, vanta } from './hjalp.js';

const start = document.querySelector('#start');
let raknare = 0;

async function kor() {
  raknare++;
  skriv('1. kor startar, räknare = ' + raknare);

  setTimeout(() => {
    skriv('3. setTimeout (0 ms) körs när den synkrona koden är klar');
  }, 0);

  const svar = await vanta(200, 'klart');
  skriv('4. efter await: ' + svar);

  const tal = [1, 2, 3];
  let summa = 0;
  for (const t of tal) {
    summa += t;
  }
  skriv('5. summan är ' + summa);
}

start.addEventListener('click', () => {
  kor();
  skriv('2. raden efter kor() körs innan await är klar');
});
