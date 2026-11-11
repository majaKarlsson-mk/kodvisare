const logg = document.querySelector('#logg');

export function skriv(text) {
  const li = document.createElement('li');
  li.textContent = text;
  logg.append(li);
}

export function vanta(ms, varde) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(varde), ms);
  });
}
