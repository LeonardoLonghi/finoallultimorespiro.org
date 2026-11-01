// Scrittura sul Google Sheet tramite service account (API Sheets v4, JWT firmato senza dipendenze).
// La LETTURA in build resta quella pubblica via CSV (sheets.mjs): qui serve solo per sync-news.
//
// GOOGLE_SERVICE_ACCOUNT = contenuto JSON della chiave, oppure percorso del file .json.
// Il foglio va condiviso come "Editor" con l'email del service account (client_email).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { request, BuildError, mask } from './util.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function loadServiceAccount(value) {
  const v = value.trim();
  const sa = JSON.parse(v.startsWith('{') ? v : await fs.readFile(v, 'utf8'));
  if (!sa.client_email || !sa.private_key) throw new BuildError('GOOGLE_SERVICE_ACCOUNT: mancano client_email o private_key');
  return sa;
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
  const res = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new BuildError(`Autenticazione service account fallita: ${mask(json.error_description || json.error || res.status)}`);
  return json.access_token;
}

/** Client minimo: get dei valori, metadati, batchUpdate (struttura) e values:batchUpdate. */
export async function sheetsClient(sa, spreadsheetId) {
  const token = await accessToken(sa);
  async function call(method, path, body) {
    const res = await request(`${API}/${spreadsheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 403 ? ` (condividi il foglio come Editor con ${sa.client_email})` : '';
      throw new BuildError(`Sheets API ${res.status}: ${mask(json.error?.message || '')}${hint}`);
    }
    return json;
  }
  return {
    email: sa.client_email,
    values: (range) => call('GET', `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`).then((r) => r.values || []),
    sheetGid: async (title) => {
      const r = await call('GET', '?fields=sheets.properties(sheetId,title)');
      const s = r.sheets.find((x) => x.properties.title === title);
      if (!s) throw new BuildError(`Foglio "${title}" non trovato`);
      return s.properties.sheetId;
    },
    batchUpdate: (requests) => call('POST', ':batchUpdate', { requests }),
    // RAW: i valori restano esattamente come passati (gli id lunghi restano testo, non numeri arrotondati).
    setValues: (data) => call('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data }),
  };
}

/** Indice di colonna (0-based) → lettera A1 (0 → A, 26 → AA). */
export function colLetter(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
