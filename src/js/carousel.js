// Carosello foto per il popup della mappa: frecce, swipe, tastiera, contatore, lazy-load.
// Mostra subito la miniatura (già in cache dal marker) e la sostituisce con l'immagine grande.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createCarousel(photos) {
  const el = document.createElement('div');
  el.className = 'pcar';
  const multi = photos.length > 1;
  el.innerHTML = `
    <div class="pcar__stage">
      <img class="pcar__img" alt="">
      ${multi ? `<button class="pcar__btn pcar__btn--prev" aria-label="Foto precedente"><i class="fas fa-chevron-left"></i></button>
      <button class="pcar__btn pcar__btn--next" aria-label="Foto successiva"><i class="fas fa-chevron-right"></i></button>
      <span class="pcar__count"></span>` : ''}
    </div>
    <div class="pcar__caption"><strong class="pcar__title"></strong> <span class="pcar__year"></span></div>`;

  const imgEl = el.querySelector('.pcar__img');
  const stage = el.querySelector('.pcar__stage');
  let i = 0;
  const loaded = new Set();

  function preload(k) {
    const p = photos[(k + photos.length) % photos.length];
    if (loaded.has(p.src)) return;
    const im = new Image();
    im.onload = () => loaded.add(p.src);
    im.src = p.src;
  }

  function show(k) {
    i = (k + photos.length) % photos.length;
    const p = photos[i];
    stage.style.aspectRatio = p.w && p.h ? `${p.w} / ${p.h}` : '';
    imgEl.alt = p.caption || '';
    imgEl.src = loaded.has(p.src) ? p.src : p.thumb;
    if (!loaded.has(p.src)) {
      const want = p.src;
      const im = new Image();
      im.onload = () => { loaded.add(want); if (photos[i].src === want) imgEl.src = want; };
      im.src = want;
    }
    el.querySelector('.pcar__title').textContent = p.caption || '';
    el.querySelector('.pcar__year').textContent = p.year ? `· ${p.year}` : '';
    if (multi) {
      el.querySelector('.pcar__count').textContent = `${i + 1}/${photos.length}`;
      preload(i + 1); preload(i - 1);
    }
  }

  if (multi) {
    el.querySelector('.pcar__btn--prev').addEventListener('click', (e) => { e.stopPropagation(); show(i - 1); });
    el.querySelector('.pcar__btn--next').addEventListener('click', (e) => { e.stopPropagation(); show(i + 1); });
    let x0 = null, y0 = null;
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? i + 1 : i - 1);
      x0 = null;
    });
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
  }

  show(0);
  return el;
}
