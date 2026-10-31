// Parser CSV RFC 4180: virgolette, virgolette raddoppiate, virgole e a-capo nei campi, CRLF, BOM.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV → array di oggetti usando la prima riga come intestazione (normalizzata in minuscolo). */
export function csvToObjects(text) {
  const [header = [], ...rows] = parseCsv(text);
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r, idx) => {
      const o = { _row: idx + 2 }; // numero di riga nel foglio (1 = intestazione)
      keys.forEach((k, j) => { if (k) o[k] = (r[j] ?? '').trim(); });
      return o;
    });
}
