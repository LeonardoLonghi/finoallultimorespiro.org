// Template delle card dei post. Una funzione per tipo: sostituibili singolarmente.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

const img = (src, alt = '', m = {}) =>
  `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async"${m.w ? ` width="${m.w}" height="${m.h}"` : ''}>`;

/** Una singola tessera media: immagine, o anteprima video che rimanda a Facebook. */
function mediaTile(m, post, extra = '') {
  if (m.kind === 'video') {
    return `<a class="tile tile--video" href="${esc(m.href || post.permalink)}" target="_blank" rel="noopener" aria-label="Guarda il video su Facebook">
      ${img(m.poster, '', m)}<span class="tile__play"><i class="fas fa-play"></i></span>${extra}</a>`;
  }
  return `<a class="tile" href="${esc(post.permalink)}" target="_blank" rel="noopener">${img(m.src, '', m)}${extra}</a>`;
}

const header = (post) => `<time class="post__date" datetime="${esc(post.date)}">${fmtDate(post.date)}</time>`;
const text = (post) => post.text ? `<p class="post__text">${esc(post.text.trim())}</p>` : '';
const footer = (post) => `<a class="post__more" href="${esc(post.permalink)}" target="_blank" rel="noopener">Leggi su Facebook <i class="fas fa-external-link-alt"></i></a>`;

export const templates = {
  photo: (p) => `${p.media[0] ? `<div class="post__media">${mediaTile(p.media[0], p)}</div>` : ''}`,

  album: (p) => {
    const shown = p.media.slice(0, 4);
    const rest = p.media.length - shown.length;
    return `<div class="post__media post__media--album n${shown.length}">${shown.map((m, i) =>
      mediaTile(m, p, i === shown.length - 1 && rest > 0 ? `<span class="tile__more">+${rest}</span>` : '')).join('')}</div>`;
  },

  video: (p) => p.media[0] ? `<div class="post__media">${mediaTile({ ...p.media[0], kind: 'video' }, p)}</div>` : '',
  reel: (p) => templates.video(p),

  link: (p) => p.link ? `<a class="linkcard" href="${esc(p.link.url)}" target="_blank" rel="noopener">
      ${p.link.image ? `<span class="linkcard__img">${img(p.link.image)}</span>` : ''}
      <span class="linkcard__body">
        <span class="linkcard__domain">${esc(p.link.domain)}</span>
        <span class="linkcard__title">${esc(p.link.title)}</span>
      </span></a>` : '',

  status: () => '',
};

export function postCard(post) {
  const body = (templates[post.type] || templates.photo)(post);
  return `<article class="post post--${esc(post.type)}">${body}<div class="post__body">${header(post)}${text(post)}${footer(post)}</div></article>`;
}

export function renderPosts(posts, config = {}) {
  const visible = config.visiblePosts ?? 5;
  document.getElementById('posts-grid').innerHTML = posts.slice(0, visible).map(postCard).join('');

  const older = posts.slice(visible);
  if (!older.length) return;
  const wrap = document.getElementById('posts-more');
  const track = document.getElementById('posts-carousel');
  track.innerHTML = older.map(postCard).join('');
  wrap.hidden = false;
  const step = () => track.clientWidth * 0.9;
  wrap.querySelector('.hscroll__btn--prev').onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
  wrap.querySelector('.hscroll__btn--next').onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
}
