// Lettura del CMS (Google Sheet pubblico) via CSV, senza chiave.
//
// Nota: l'endpoint gviz (`gviz/tq?tqx=out:csv&sheet=NOME`) deduce il tipo di ogni colonna e
// SVUOTA i valori del tipo minoritario (es. id salvati come testo in una colonna di numeri).
// Per questo risolviamo nome→gid da `htmlview` e scarichiamo da `export?format=csv&gid=`,
// che restituisce i valori esattamente come scritti. gviz resta come ripiego.
import { csvToObjects } from './csv.mjs';
import { getText, warn } from './util.mjs';

let gidPromise = null; // promise in cache: le letture parallele condividono la stessa richiesta

function sheetGids(sheetId) {
  gidPromise ??= (async () => {
    const gids = {};
    try {
      const html = await getText(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
      for (const m of html.matchAll(/\{name:\s*"((?:[^"\\]|\\.)*)",[^{}]*?gid:\s*"(\d+)"/g)) {
        gids[JSON.parse(`"${m[1].replace(/\\x([0-9a-f]{2})/gi, '\\u00$1')}"`)] = m[2];
      }
    } catch (e) {
      warn(`Impossibile leggere l'elenco dei fogli (${e.message}); uso gviz come ripiego`);
    }
    return gids;
  })();
  return gidPromise;
}

export async function readSheet(sheetId, name) {
  const gids = await sheetGids(sheetId);
  let url;
  if (gids[name] !== undefined) {
    url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gids[name]}`;
  } else {
    warn(`Foglio "${name}" non trovato in htmlview: uso gviz (alcuni valori potrebbero risultare vuoti)`);
    url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  }
  const text = await getText(url);
  if (/^\s*<!DOCTYPE html/i.test(text)) throw new Error(`Il foglio "${name}" non è pubblico o non esiste`);
  return csvToObjects(text);
}

export const isTrue = (v) => /^(true|vero|1|si|sì|x)$/i.test(String(v).trim());

/** "52,3730796" → 52.3730796 ; accetta anche il punto. NaN se non numerico. */
export function parseCoord(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
