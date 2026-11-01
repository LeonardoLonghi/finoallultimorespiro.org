#!/usr/bin/env node
// Sincronizza il foglio "news" con la pagina Facebook: aggiunge i post non ancora presenti,
// con show = FALSE (casella di spunta), così chiunque può scegliere cosa mostrare.
// Le righe esistenti non vengono modificate, salvo riempire data/titolo/link se vuoti;
// alla fine tutte le righe vengono ordinate per data (dalla più recente).
//
//   npm run sync              errori → exit 1
//   npm run sync -- --soft    errori o service account assente → solo avviso, exit 0 (usato prima della build)
//   npm run sync -- --dry-run mostra cosa farebbe senza scrivere
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, warn, exists, mask, BuildError } from './lib/util.mjs';
import { getPageToken, listPosts, suggestType, MAX_SCAN } from './lib/facebook.mjs';
import { loadServiceAccount, sheetsClient, colLetter } from './lib/gsheets.mjs';

const SHEET = 'news';
const COLUMNS = ['id', 'type', 'show', 'data', 'titolo', 'link']; // mancanti → aggiunte in fondo all'intestazione

const args = new Set(process.argv.slice(2));
const SOFT = args.has('--soft');
const DRY = args.has('--dry-run');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, 'SECRETS.env');
if (await exists(envFile)) process.loadEnvFile(envFile);

const shortId = (v) => String(v ?? '').replace(/^.*_/, '').trim();

function title(raw) {
  const line = (raw.message || '').split('\n').map((l) => l.trim()).find(Boolean)
    || raw.attachments?.data?.[0]?.title || '(senza testo)';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

async function main() {
  const { FB_MAIN_TOKEN, FB_PAGE_ID, GDRIVE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT } = process.env;
  const missing = Object.entries({ FB_MAIN_TOKEN, FB_PAGE_ID, GDRIVE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new BuildError(`Variabili d'ambiente mancanti: ${missing.join(', ')}`);

  const sa = await loadServiceAccount(GOOGLE_SERVICE_ACCOUNT);
  const sheets = await sheetsClient(sa, GDRIVE_SHEET_ID);

  const pageToken = await getPageToken(FB_MAIN_TOKEN, FB_PAGE_ID);
  const posts = await listPosts(FB_PAGE_ID, pageToken, MAX_SCAN);
  log(`Facebook: ${posts.length} post letti dalla pagina`);

  const rows = await sheets.values(SHEET);
  const header = (rows[0] || []).map((h) => String(h).trim());
  const lower = header.map((h) => h.toLowerCase());
  const updates = [];

  // Intestazione: aggiunge le colonne mancanti in fondo.
  const col = {};
  for (const name of COLUMNS) {
    let i = lower.indexOf(name);
    if (i < 0) {
      i = header.length;
      header.push(name); lower.push(name);
      updates.push({ range: `${SHEET}!${colLetter(i)}1`, values: [[name]] });
      log(`Foglio: aggiungo la colonna "${name}"`);
    }
    col[name] = i;
  }

  const info = (raw) => ({
    id: shortId(raw.id),
    type: suggestType(raw),
    show: false,
    data: (raw.created_time || '').slice(0, 10),
    titolo: title(raw),
    link: raw.permalink_url || '',
  });

  // Righe esistenti: indice per id; riempi solo le celle data/titolo/link vuote.
  const byId = new Map(posts.map((p) => [shortId(p.id), p]));
  const present = new Set();
  let filled = 0;
  rows.slice(1).forEach((r, k) => {
    const id = shortId(r[col.id]);
    if (!id) return;
    present.add(id);
    const raw = byId.get(id);
    if (!raw) return;
    const v = info(raw);
    for (const name of ['data', 'titolo', 'link']) {
      if (!String(r[col[name]] ?? '').trim()) {
        updates.push({ range: `${SHEET}!${colLetter(col[name])}${k + 2}`, values: [[v[name]]] });
        filled++;
      }
    }
  });

  // Post nuovi, dal più recente: vanno nelle righe 2..n+1.
  const fresh = posts.filter((p) => !present.has(shortId(p.id))).map(info);
  log(`Foglio: ${present.size} post già presenti, ${fresh.length} nuovi da aggiungere, ${filled} celle vuote da completare`);
  for (const p of fresh) log(`  + ${p.data}  ${p.type.padEnd(6)}  ${p.titolo}`);

  if (DRY) { log('--dry-run: nessuna modifica scritta'); return; }
  if (!fresh.length && !updates.length) return;

  const gid = await sheets.sheetGid(SHEET);
  if (fresh.length) {
    const range = { sheetId: gid, startRowIndex: 1, endRowIndex: 1 + fresh.length };
    await sheets.batchUpdate([
      { insertDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 1, endIndex: 1 + fresh.length }, inheritFromBefore: false } },
      // show come casella di spunta, id come testo semplice (niente arrotondamento dei numeri lunghi).
      { setDataValidation: { range: { ...range, startColumnIndex: col.show, endColumnIndex: col.show + 1 },
        rule: { condition: { type: 'BOOLEAN' }, strict: true } } },
      { repeatCell: { range: { ...range, startColumnIndex: col.id, endColumnIndex: col.id + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    ]);
    // Le righe esistenti sono scese di fresh.length: ricalcola i riferimenti già preparati.
    for (const u of updates) {
      u.range = u.range.replace(/(\D)(\d+)$/, (_, c, n) => (Number(n) > 1 ? `${c}${Number(n) + fresh.length}` : `${c}${n}`));
    }
    fresh.forEach((p, k) => {
      const row = new Array(header.length).fill(null);
      for (const name of COLUMNS) row[col[name]] = p[name];
      updates.push({ range: `${SHEET}!A${k + 2}:${colLetter(header.length - 1)}${k + 2}`, values: [row] });
    });
  }
  await sheets.setValues(updates);
  // Ordina le righe per data, dalla più recente (le date sono testo AAAA-MM-GG; le vuote finiscono in fondo).
  await sheets.batchUpdate([{ sortRange: {
    range: { sheetId: gid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length },
    sortSpecs: [{ dimensionIndex: col.data, sortOrder: 'DESCENDING' }],
  } }]);
  log(`✅ Foglio "${SHEET}" aggiornato (service account ${sheets.email})`);
}

main().catch((e) => {
  const msg = mask(e instanceof BuildError ? e.message : (e.stack || e.message));
  if (SOFT) { warn(`sync-news saltato: ${msg}`); process.exit(0); }
  console.error(`\n❌ sync-news fallito: ${msg}`);
  process.exit(1);
});
