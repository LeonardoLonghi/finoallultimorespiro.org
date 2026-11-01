// Utility comuni: log con mascheramento dei segreti, fetch con retry, fs helpers.
import fs from 'node:fs/promises';
import path from 'node:path';

const warnings = [];

/** Maschera token, chiavi e valori segreti noti in qualsiasi stringa. */
export function mask(str) {
  let s = String(str ?? '');
  s = s.replace(/([?&](?:access_token|key|client_secret|appsecret_proof)=)[^&\s"']+/gi, '$1***');
  for (const name of ['FB_MAIN_TOKEN', 'FB_TOKEN', 'GDRIVE_API_KEY', 'APP_SECRET']) {
    const v = process.env[name];
    if (v && v.length >= 8) s = s.split(v).join('***');
  }
  return s;
}

export const log = (...a) => console.log(mask(a.join(' ')));
export function warn(...a) {
  const msg = mask(a.join(' '));
  warnings.push(msg);
  console.warn('⚠️  ' + msg);
}
export const getWarnings = () => warnings;

export class BuildError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch con 3 tentativi sugli errori di rete/5xx. Gli errori riportano l'URL mascherato. */
export async function request(url, { retries = 3, ...opts } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', ...opts });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(800 * (i + 1));
  }
  throw new BuildError(`Richiesta fallita (${lastErr?.message}): ${mask(url)}`);
}

export async function getJson(url) {
  const res = await request(url);
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = null; }
  if (!res.ok || !json || json.error) {
    const detail = json?.error ? `${json.error.code ?? ''} ${json.error.message ?? JSON.stringify(json.error)}` : body.slice(0, 200);
    throw new BuildError(`HTTP ${res.status} ${mask(detail)} — ${mask(url)}`);
  }
  return json;
}

export async function getText(url) {
  const res = await request(url);
  if (!res.ok) throw new BuildError(`HTTP ${res.status} — ${mask(url)}`);
  return res.text();
}

export async function getBuffer(url) {
  const res = await request(url);
  if (!res.ok) throw new BuildError(`HTTP ${res.status} — ${mask(url)}`);
  return Buffer.from(await res.arrayBuffer());
}

export const exists = (p) => fs.access(p).then(() => true, () => false);

export async function writeFileSafe(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, p);
}

export async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

/** Slug sicuro per nomi file (mantiene leggibilità, niente spazi/accenti). */
export function slug(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase() || 'file';
}

/** Esegue fn su items con concorrenza limitata. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
