#!/usr/bin/env node
// Build del sito statico: legge il CMS (Google Sheet), scarica post Facebook e foto Drive,
// produce dist/ con data.json + immagini. Stesso codice in locale e su GitHub Actions.
//
//   npm run build                                   build completa
//   npm run build -- --offline                      nessuna rete: riusa .cache/ e l'ultimo data.json
//   npm run build -- --limit-posts=5 --limit-photos=20   build ridotta
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { log, warn, getWarnings, BuildError, exists, writeFileSafe, readJson, slug, pool, getBuffer, mask } from './lib/util.mjs';
import { readSheet, isTrue, parseCoord } from './lib/sheets.mjs';
import { getPageToken, findPosts, normalizePost } from './lib/facebook.mjs';
import { listTree, download } from './lib/drive.mjs';
import { processImage, PROCESS_VERSION } from './lib/images.mjs';
import { createMatcher } from './lib/match.mjs';

// ── Configurazione ─────────────────────────────────────────────────────────────
export const CONFIG = {
  maxPosts: 30,      // post totali pubblicati (i primi `visiblePosts` in griglia, gli altri nel carosello)
  visiblePosts: 5,
};
const POST_TYPES = ['photo', 'album', 'video', 'reel', 'link', 'status'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT_CACHE = path.join(CACHE, 'out');          // immagini elaborate, già nella struttura di dist/
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

// ── Argomenti ed env ───────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const OFFLINE = !!args.offline;
const LIMIT_POSTS = args['limit-posts'] ? Number(args['limit-posts']) : Infinity;
const LIMIT_PHOTOS = args['limit-photos'] ? Number(args['limit-photos']) : Infinity;

const envFile = path.join(ROOT, 'SECRETS.env');
if (await exists(envFile)) process.loadEnvFile(envFile);

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new BuildError(`Variabili d'ambiente mancanti: ${missing.join(', ')}`);
  return names.map((n) => process.env[n]);
}

const stats = { postsRequested: 0, postsPublished: 0, postImgNew: 0, postImgCached: 0,
  photoRows: 0, photosPublished: 0, photosNew: 0, photosCached: 0, photosSkipped: 0 };

const hash = (s, n = 10) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const rel = (p) => path.relative(OUT_CACHE, p).split(path.sep).join('/');

// ── Facebook ───────────────────────────────────────────────────────────────────
async function buildPosts() {
  const [token, pageId, sheetId] = requireEnv('FB_MAIN_TOKEN', 'FB_PAGE_ID', 'GDRIVE_SHEET_ID');
  const rows = await readSheet(sheetId, 'news');
  const selected = [];
  for (const r of rows) {
    if (!isTrue(r.show)) continue;
    const id = (r.id || '').replace(/^.*_/, '').trim();
    const type = (r.type || '').toLowerCase().trim();
    if (!/^\d+$/.test(id)) { warn(`news riga ${r._row}: id "${r.id}" non valido, saltata`); continue; }
    if (!POST_TYPES.includes(type)) warn(`news riga ${r._row}: type "${r.type}" sconosciuto (uso comunque il post)`);
    selected.push({ id, type });
  }
  const limited = selected.slice(0, Math.min(CONFIG.maxPosts, LIMIT_POSTS));
  if (selected.length > CONFIG.maxPosts) log(`ℹ️  ${selected.length} post con show=TRUE, ne pubblico ${CONFIG.maxPosts} (CONFIG.maxPosts)`);
  stats.postsRequested = limited.length;

  log(`Facebook: cerco ${limited.length} post nel feed…`);
  const pageToken = await getPageToken(token, pageId);
  const { found, scanned } = await findPosts(pageId, pageToken, limited.map((p) => p.id));
  log(`Facebook: ${found.size}/${limited.length} trovati scorrendo ${scanned} post`);

  const manifestPath = path.join(CACHE, 'fb-images.json');
  const manifest = await readJson(manifestPath, {});
  const posts = [];

  for (const sel of limited) {
    const raw = found.get(sel.id);
    if (!raw) continue;
    const post = normalizePost(raw, sel.type);
    if (sel.type !== 'status' && !post.media.length && !post.link) {
      warn(`Post ${sel.id} (${sel.type}): nessuna immagine trovata (FB: ${post.fbType})`);
    }
    // Scarica le immagini: chiave = id post + parte stabile dell'URL (senza firma/scadenza).
    const jobs = [...post.media.map((m) => ['media', m]), ...(post.link?.remote ? [['link', post.link]] : [])];
    let n = 0;
    for (const [, obj] of jobs) {
      const u = new URL(obj.remote);
      const stable = u.searchParams.get('url') || u.pathname;
      const key = `${sel.id}:${hash(stable)}:v${PROCESS_VERSION}`;
      const target = path.join(OUT_CACHE, 'img', 'posts', sel.id, `${n++}-${hash(stable, 8)}.jpg`);
      let entry = manifest[key];
      if (entry && await exists(path.join(OUT_CACHE, entry.src))) {
        stats.postImgCached++;
      } else {
        try {
          const buf = await getBuffer(obj.remote);
          const { full } = await processImage(buf, '', { thumb: false });
          await writeFileSafe(target, full.data);
          entry = manifest[key] = { src: rel(target), w: full.width, h: full.height };
          stats.postImgNew++;
        } catch (e) {
          warn(`Post ${sel.id}: immagine non scaricata (${e.message})`);
          entry = null;
        }
      }
      delete obj.remote;
      if (obj.kind === 'video') Object.assign(obj, entry ? { poster: entry.src, w: entry.w, h: entry.h } : { poster: null });
      else if (obj.kind === 'image') Object.assign(obj, entry ? { src: entry.src, w: entry.w, h: entry.h } : { src: null });
      else obj.image = entry?.src ?? null; // link card
    }
    post.media = post.media.filter((m) => m.src || m.poster);
    delete post.fbType;
    posts.push(post);
  }
  await writeFileSafe(manifestPath, JSON.stringify(manifest, null, 1));
  posts.sort((a, b) => b.date.localeCompare(a.date)); // dal più recente, indipendentemente dall'ordine nel foglio
  stats.postsPublished = posts.length;
  return posts;
}

// ── Foto "A nel mondo" (Drive) ─────────────────────────────────────────────────
async function buildPhotos() {
  const [key, folderId, sheetId] = requireEnv('GDRIVE_API_KEY', 'GDRIVE_FOLDER_ID', 'GDRIVE_SHEET_ID');
  const rows = await readSheet(sheetId, 'foto');
  stats.photoRows = rows.length;

  log('Drive: elenco la cartella…');
  const all = await listTree(folderId, key);
  const files = all.filter((f) => f.mimeType.startsWith('image/'));
  log(`Drive: ${files.length} immagini trovate (${all.length - files.length} altri file ignorati, es. video)`);
  const match = createMatcher(files);
  const used = new Set();

  const valid = [];
  for (const r of rows) {
    const where = `foto riga ${r._row}`;
    if (!r.lat || !r.lng || !r.cartella || !r.file) {
      if (r.lat || r.lng || r.cartella || r.file || r.caption) warn(`${where}: riga incompleta, ignorata`);
      stats.photosSkipped++;
      continue;
    }
    const lat = parseCoord(r.lat), lng = parseCoord(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      warn(`${where}: coordinate non valide (${r.lat}; ${r.lng}), ignorata`);
      stats.photosSkipped++;
      continue;
    }
    const p = `${r.cartella}/${r.file}`;
    const m = match(p);
    if (!m) {
      const isVideo = all.some((f) => !f.mimeType.startsWith('image/') && f.path.normalize('NFC').toLowerCase() === p.normalize('NFC').toLowerCase());
      warn(`${where}: ${isVideo ? `"${p}" è un video, non supportato sulla mappa` : `file "${p}" non trovato su Drive`}`);
      stats.photosSkipped++;
      continue;
    }
    const f = m.file;
    if (m.note) warn(`${where}: "${p}": ${m.note}`);
    if (used.has(f.id)) warn(`${where}: "${f.path}" è già usato da un'altra riga`);
    used.add(f.id);
    valid.push({ lat, lng, caption: r.caption, year: String(r.cartella), file: f });
  }

  if (LIMIT_PHOTOS === Infinity) {
    const unused = files.filter((f) => !used.has(f.id));
    const byFolder = Map.groupBy(unused, (f) => path.posix.dirname(f.path));
    for (const [folder, list] of byFolder) {
      const names = list.map((f) => f.name);
      warn(`Drive ${folder === '.' ? '(radice)' : folder}/: ${list.length} file non presenti nel foglio (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})`);
    }
  }

  const todo = valid.slice(0, LIMIT_PHOTOS);
  const manifestPath = path.join(CACHE, 'photos.json');
  const manifest = await readJson(manifestPath, {});

  const photos = await pool(todo, 4, async (ph) => {
    const f = ph.file;
    const cacheKey = `${f.id}:${f.md5Checksum || f.modifiedTime}:v${PROCESS_VERSION}`;
    let entry = manifest[cacheKey];
    if (entry && await exists(path.join(OUT_CACHE, entry.src)) && await exists(path.join(OUT_CACHE, entry.thumb))) {
      stats.photosCached++;
    } else {
      try {
        const ext = path.extname(f.name).toLowerCase() || '.bin';
        const orig = path.join(CACHE, 'drive', `${f.id}-${f.md5Checksum || hash(f.modifiedTime)}${ext}`);
        let buf;
        if (await exists(orig)) buf = await fs.readFile(orig);
        else { buf = await download(f.id, key); await writeFileSafe(orig, buf); }
        const { full, thumb } = await processImage(buf, f.name);
        const base = `${slug(path.parse(f.name).name)}-${(f.md5Checksum || hash(f.id)).slice(0, 8)}`;
        const dir = path.join(OUT_CACHE, 'img', 'a', slug(ph.year));
        await writeFileSafe(path.join(dir, `${base}.jpg`), full.data);
        await writeFileSafe(path.join(dir, `${base}-t.jpg`), thumb.data);
        entry = manifest[cacheKey] = {
          src: rel(path.join(dir, `${base}.jpg`)), thumb: rel(path.join(dir, `${base}-t.jpg`)),
          w: full.width, h: full.height,
        };
        stats.photosNew++;
      } catch (e) {
        warn(`Foto "${f.path}": elaborazione fallita (${e.message}), saltata`);
        stats.photosSkipped++;
        return null;
      }
    }
    return { lat: ph.lat, lng: ph.lng, caption: ph.caption, year: ph.year, src: entry.src, thumb: entry.thumb, w: entry.w, h: entry.h };
  });

  await writeFileSafe(manifestPath, JSON.stringify(manifest, null, 1));
  const out = photos.filter(Boolean);
  stats.photosPublished = out.length;
  return out;
}

// ── Assemblaggio dist/ ─────────────────────────────────────────────────────────
async function assemble(data) {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  await fs.cp(SRC, DIST, { recursive: true }); // frontend (HTML/CSS/JS)

  await fs.cp(path.join(ROOT, 'public'), path.join(DIST, 'public'), {
    recursive: true,
    // public/a/ (vecchie foto statiche) non va pubblicato: le foto arrivano da Drive.
    filter: (p) => { const a = path.join(ROOT, 'public', 'a'); return p !== a && !p.startsWith(a + path.sep); },
  });
  for (const f of ['favicon.ico', 'CNAME']) {
    if (await exists(path.join(ROOT, f))) await fs.copyFile(path.join(ROOT, f), path.join(DIST, f));
  }

  // Copia solo le immagini referenziate (niente file orfani in dist/).
  const refs = new Set();
  for (const p of data.posts) {
    for (const m of p.media) { if (m.src) refs.add(m.src); if (m.poster) refs.add(m.poster); }
    if (p.link?.image) refs.add(p.link.image);
  }
  for (const ph of data.photos) { refs.add(ph.src); refs.add(ph.thumb); }
  let missing = 0;
  for (const r of refs) {
    const from = path.join(OUT_CACHE, r);
    if (!(await exists(from))) { missing++; continue; }
    await fs.mkdir(path.dirname(path.join(DIST, r)), { recursive: true });
    await fs.copyFile(from, path.join(DIST, r));
  }
  if (missing) warn(`${missing} immagini referenziate mancanti in .cache/out`);

  await fs.writeFile(path.join(DIST, 'data.json'), JSON.stringify(data));
  return refs.size - missing;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  log(`Build ${OFFLINE ? '(offline) ' : ''}— Node ${process.version}`);
  let data;
  const lastData = path.join(CACHE, 'last-data.json');

  if (OFFLINE) {
    data = await readJson(lastData);
    if (!data) throw new BuildError('Modalità --offline: nessun .cache/last-data.json, esegui prima una build completa');
    data.posts = data.posts.slice(0, LIMIT_POSTS);
    data.photos = data.photos.slice(0, LIMIT_PHOTOS);
    stats.postsPublished = data.posts.length;
    stats.photosPublished = stats.photosCached = data.photos.length;
  } else {
    const [posts, photos] = await Promise.all([buildPosts(), buildPhotos()]);
    data = { generatedAt: new Date().toISOString(), config: CONFIG, posts, photos };
    // Non sovrascrivere l'ultimo data.json "completo" con una build ridotta.
    if (LIMIT_POSTS === Infinity && LIMIT_PHOTOS === Infinity) await writeFileSafe(lastData, JSON.stringify(data, null, 1));
  }

  const nImg = await assemble(data);
  const w = getWarnings();
  const kb = await dirSize(DIST);
  console.log(`
──────────── Riepilogo build ────────────
Post:   ${stats.postsPublished} pubblicati${OFFLINE ? '' : ` / ${stats.postsRequested} richiesti (show=TRUE)`}
        immagini post: ${stats.postImgNew} nuove, ${stats.postImgCached} in cache
Foto:   ${stats.photosPublished} pubblicate${OFFLINE ? '' : ` / ${stats.photoRows} righe nel foglio`}
        ${stats.photosNew} nuove, ${stats.photosCached} in cache, ${stats.photosSkipped} saltate
dist/:  ${nImg} immagini, ${(kb / 1024).toFixed(1)} MB
Warning: ${w.length}${w.length ? '\n  - ' + w.join('\n  - ') : ''}
Tempo:  ${((Date.now() - t0) / 1000).toFixed(1)}s
─────────────────────────────────────────`);
}

async function dirSize(dir) {
  let total = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await fs.stat(path.join(e.parentPath, e.name))).size;
  }
  return total / 1024;
}

main().catch((e) => {
  console.error('\n❌ Build fallita: ' + mask(e instanceof BuildError ? e.message : (e.stack || e.message)));
  process.exit(1);
});
