// Avvio: carica data.json (generato in build) e popola post e mappa.
import { renderPosts } from './posts.js';
import { initMap } from './map.js';

async function main() {
  let data;
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    data = await res.json();
  } catch (e) {
    console.error('Impossibile caricare data.json', e);
    return;
  }
  renderPosts(data.posts, data.config);
  initMap(document.getElementById('map'), data.photos);
  jumpToHash();
}

// I post e la mappa vengono inseriti dopo il caricamento: il browser ha già scrollato all'ancora
// (es. about.html → /#mappa) quando la pagina era ancora corta. Riallinea a contenuto pronto.
function jumpToHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant' });
}
window.addEventListener('load', jumpToHash);

main();
