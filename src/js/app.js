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
}

main();
