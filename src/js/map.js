/* global L */
// Mappa "A nel mondo" con marker fusi per vicinanza (clustering greedy in pixel, niente plugin).
// - I gruppi si ricalcolano a ogni zoomend; al massimo zoom si fondono solo coordinate identiche.
// - Click su un marker: popup con carosello di TUTTE le foto del gruppo (nessuno zoom).
import { createCarousel } from './carousel.js';

const MERGE_PX = 40;

export function initMap(container, photos) {
  const map = L.map(container, {
    scrollWheelZoom: false, worldCopyJump: true, maxZoom: 18,
    maxBounds: [[-85, -540], [85, 540]], maxBoundsViscosity: 1, // niente fascia grigia oltre i poli
  });
  // Zoom minimo tale che il mondo (256·2^z px) riempia l'altezza del contenitore.
  const fitMinZoom = () => map.setMinZoom(Math.max(1, Math.ceil(Math.log2(container.clientHeight / 256))));
  fitMinZoom();
  window.addEventListener('resize', fitMinZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
  }).addTo(map);

  // Rotella abilitata solo dopo un click sulla mappa, per non intrappolare lo scroll della pagina.
  map.on('click', () => map.scrollWheelZoom.enable());
  container.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

  if (photos.length) map.fitBounds(L.latLngBounds(photos.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 5 });
  else map.setView([20, 0], 2);

  const layer = L.layerGroup().addTo(map);

  function cluster() {
    const radius = map.getZoom() >= map.getMaxZoom() ? 0 : MERGE_PX;
    const groups = [];
    for (const p of photos) {
      const pt = map.latLngToLayerPoint([p.lat, p.lng]); // le distanze in pixel non dipendono dal pan
      // L'àncora del gruppo è il primo punto (non si sposta): coordinate identiche finiscono
      // sempre nello stesso gruppo, a qualsiasi zoom.
      let g = groups.find((g) => g.pt.distanceTo(pt) <= radius);
      if (!g) groups.push((g = { pt, photos: [] }));
      g.photos.push(p);
    }
    return groups;
  }

  function markerFor(g) {
    const n = g.photos.length;
    const latlng = map.layerPointToLatLng(g.pt);
    const icon = L.divIcon({
      className: 'amarker',
      html: `<span class="amarker__img" style="background-image:url('${g.photos[0].thumb}')"></span>${n > 1 ? `<span class="amarker__badge">${n}</span>` : ''}`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const m = L.marker(latlng, { icon, title: n > 1 ? `${n} foto` : g.photos[0].caption, keyboard: true });
    m.on('click', () => {
      L.popup({ className: 'apopup', maxWidth: 360, minWidth: 240, autoPanPadding: [20, 20] })
        .setLatLng(latlng)
        .setContent(createCarousel(g.photos))
        .openOn(map);
    });
    return m;
  }

  function render() {
    layer.clearLayers();
    for (const g of cluster()) layer.addLayer(markerFor(g));
  }

  map.on('zoomend', render);
  render();
  return map;
}
