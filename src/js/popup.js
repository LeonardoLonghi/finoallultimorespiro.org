// Popup "fluttuante" per la mappa: vive nel <body> e non nel contenitore Leaflet,
// così non viene tagliato dai bordi della mappa (overflow: hidden) e può sporgere sulla pagina.
// Segue il marker durante pan/zoom; si apre sopra o sotto a seconda dello spazio nel viewport.
const GAP = 28;    // distanza dal centro del marker (raggio marker 22px + punta)
const MARGIN = 8;  // distanza minima dai bordi del viewport

export function createFloatingPopup(map) {
  const el = document.createElement('div');
  el.className = 'fpopup';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.innerHTML = '<button class="fpopup__close" aria-label="Chiudi">&times;</button><div class="fpopup__body"></div><span class="fpopup__tip"></span>';
  document.body.append(el);
  const body = el.querySelector('.fpopup__body');
  const tip = el.querySelector('.fpopup__tip');
  const container = map.getContainer();
  let latlng = null;

  function place() {
    if (!latlng) return;
    const r = container.getBoundingClientRect();
    const p = map.latLngToContainerPoint(latlng);
    // Marker uscito dall'area visibile della mappa: nascondi senza chiudere.
    const inside = p.x >= 0 && p.y >= 0 && p.x <= r.width && p.y <= r.height;
    el.style.visibility = inside ? '' : 'hidden';
    if (!inside) return;

    const x = r.left + p.x, y = r.top + p.y; // coordinate nel viewport
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const spaceAbove = y - GAP - MARGIN, spaceBelow = vh - y - GAP - MARGIN;
    const above = spaceAbove >= h || (spaceBelow < h && spaceAbove >= spaceBelow);
    const left = Math.min(Math.max(MARGIN, x - w / 2), vw - w - MARGIN);
    const top = above ? y - GAP - h : y + GAP;

    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${top + window.scrollY}px`;
    el.classList.toggle('fpopup--below', !above);
    tip.style.left = `${Math.min(Math.max(16, x - left), w - 16)}px`;
  }

  function open(ll, content) {
    latlng = ll;
    body.replaceChildren(content);
    el.hidden = false;
    place();
    content.focus?.({ preventScroll: true });
  }

  function close() {
    if (!latlng) return;
    latlng = null;
    el.hidden = true;
    body.replaceChildren();
  }

  // Le immagini caricate cambiano l'altezza: riposiziona.
  new ResizeObserver(place).observe(el);
  map.on('move zoom', place);
  map.on('click zoomstart', close);
  window.addEventListener('resize', place);
  el.querySelector('.fpopup__close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => {
    if (latlng && !el.contains(e.target) && !container.contains(e.target)) close();
  });

  return { open, close };
}
