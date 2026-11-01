// Facebook Graph API: Page Token da /me/accounts, poi lettura del solo feed /{page}/posts.
// (Le query sul singolo post falliscono con errore #12, quindi si pagina sul feed.)
import { getJson, BuildError, warn } from './util.mjs';

export const GRAPH = 'https://graph.facebook.com/v25.0';
export const MAX_SCAN = 200; // post più recenti considerati (sia da sync-news che dalla build)

const FIELDS = 'id,message,created_time,permalink_url,full_picture,'
  + 'attachments{media_type,type,url,title,description,media,subattachments{media,url,type}}';

export async function getPageToken(mainToken, pageId) {
  let url = `${GRAPH}/me/accounts?fields=id,access_token&limit=100&access_token=${mainToken}`;
  while (url) {
    const r = await getJson(url);
    const page = r.data.find((a) => a.id === pageId);
    if (page) return page.access_token;
    url = r.paging?.next;
  }
  throw new BuildError(`La pagina FB_PAGE_ID non è tra quelle gestite dal token (/me/accounts)`);
}

/** Cerca nel feed gli id (parte dopo "_") richiesti. Ritorna Map id → post grezzo. */
export async function findPosts(pageId, pageToken, ids) {
  const wanted = new Set(ids);
  const found = new Map();
  let scanned = 0;
  let url = `${GRAPH}/${pageId}/posts?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${pageToken}`;
  while (url && scanned < MAX_SCAN && found.size < wanted.size) {
    const r = await getJson(url);
    for (const p of r.data) {
      scanned++;
      const short = p.id.split('_').pop();
      if (wanted.has(short)) found.set(short, p);
    }
    url = r.paging?.next;
  }
  for (const id of wanted) {
    if (!found.has(id)) warn(`Post ${id} non trovato negli ultimi ${scanned} post del feed: saltato`);
  }
  return { found, scanned };
}

/** Ultimi `max` post della pagina (dal più recente). */
export async function listPosts(pageId, pageToken, max = MAX_SCAN) {
  const out = [];
  let url = `${GRAPH}/${pageId}/posts?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${pageToken}`;
  while (url && out.length < max) {
    const r = await getJson(url);
    out.push(...r.data);
    url = r.paging?.next;
  }
  return out.slice(0, max);
}

/** Tipo suggerito per il foglio (photo/album/video/reel/link/status), modificabile a mano. */
export function suggestType(raw) {
  const a = raw.attachments?.data?.[0];
  if (!a) return raw.full_picture ? 'photo' : 'status';
  const t = `${a.media_type || ''} ${a.type || ''}`;
  if (/reel/.test(t) || /\/reel\//.test(a.url || '')) return 'reel';
  if ((a.subattachments?.data?.length || 0) > 1) return 'album';
  if (/video/.test(t)) return 'video';
  if (a.media_type === 'link' || /share/.test(a.type || '')) return 'link';
  return 'photo';
}

/** Estrae l'URL reale dai redirect l.facebook.com e rimuove i parametri di tracciamento. */
export function cleanLink(u) {
  if (!u) return u;
  try {
    let url = new URL(u);
    if (/(^|\.)l\.facebook\.com$/.test(url.hostname) && url.searchParams.get('u')) {
      url = new URL(url.searchParams.get('u'));
    }
    for (const k of [...url.searchParams.keys()]) {
      if (/^(fbclid|utm_\w+|mibextid)$/i.test(k)) url.searchParams.delete(k);
    }
    return url.toString();
  } catch {
    return u;
  }
}

const imgSrc = (m) => m?.image?.src || null;

/**
 * Normalizza un post grezzo in una struttura indipendente da Facebook.
 * Le immagini restano come URL remoti (`remote`): verranno scaricate e sostituite in build.
 */
export function normalizePost(raw, sheetType) {
  const att = raw.attachments?.data?.[0];
  const permalink = raw.permalink_url;
  const media = [];
  let link = null;

  const pushMedia = (a) => {
    const isVideo = /video|reel/.test(a?.type || a?.media_type || '');
    const remote = imgSrc(a?.media);
    if (!remote) return;
    if (isVideo) {
      const href = a.url && /facebook\.com/.test(a.url) ? a.url : permalink;
      media.push({ kind: 'video', remote, href });
    } else {
      media.push({ kind: 'image', remote });
    }
  };

  const attType = att ? `${att.media_type}/${att.type}` : 'none';
  if (att?.subattachments?.data?.length) {
    att.subattachments.data.forEach(pushMedia);
  } else if (att && (att.media_type === 'link' || att.type === 'share' || sheetType === 'link')) {
    let domain = '';
    const url = cleanLink(att.url);
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    link = { url, title: att.title || '', description: att.description || '', domain, remote: imgSrc(att.media) };
  } else if (att) {
    pushMedia(att);
  }

  if (!media.length && !link && raw.full_picture && sheetType !== 'status') {
    media.push({ kind: /video|reel/.test(sheetType) ? 'video' : 'image', remote: raw.full_picture, href: permalink });
  }

  return {
    id: raw.id.split('_').pop(),
    type: sheetType,
    fbType: attType,
    text: raw.message || '',
    date: raw.created_time,
    permalink,
    media,
    link,
  };
}
