// Google Drive API v3 con API key (cartella pubblica in sola lettura).
import { getJson, request, BuildError, mask } from './util.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

async function listChildren(folderId, key) {
  const files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `${API}/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`
      + `&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,size)')}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '') + `&key=${key}`;
    const r = await getJson(url);
    files.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return files;
}

/** Elenca ricorsivamente la cartella. Ritorna file con `path` relativo ("2023/Amsterdam 1.jpg"). */
export async function listTree(rootId, key, prefix = '') {
  const out = [];
  for (const f of await listChildren(rootId, key)) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.mimeType === FOLDER) out.push(...(await listTree(f.id, key, p)));
    else out.push({ ...f, path: p });
  }
  return out;
}

export async function download(fileId, key) {
  const url = `${API}/files/${fileId}?alt=media&supportsAllDrives=true&key=${key}`;
  const res = await request(url);
  if (!res.ok) throw new BuildError(`Download Drive fallito HTTP ${res.status} — ${mask(url)}`);
  return Buffer.from(await res.arrayBuffer());
}
