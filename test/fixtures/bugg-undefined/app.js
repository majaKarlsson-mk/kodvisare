// Ett exempel med en vanlig bugg: felmeddelandet pekar på en rad,
// men misstaget gjordes på en annan.
const knapp = document.querySelector('#knapp');
const rubrik = document.querySelector('#rubrik');

const pokemon = { name: 'pikachu', types: ['electric'], id: 25 };

function hamtaTyp(data) {
  const typ = data.type;
  return typ;
}

function visaPokemon(data) {
  const typ = hamtaTyp(data);
  rubrik.textContent = typ.toUpperCase();
}

knapp.addEventListener('click', () => {
  visaPokemon(pokemon);
});
