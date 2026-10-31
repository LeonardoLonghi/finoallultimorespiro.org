// Associazione righe del foglio "foto" ↔ file su Drive, con fallback progressivi:
//   1. path esatto
//   2. case-insensitive + Unicode NFC + apostrofi ' ’ equivalenti a _ + spazi compattati
//   3. come (2) ma ignorando l'estensione (file caricati su Drive senza estensione)
//   4. suffisso "(n)" nel foglio → n-esimo duplicato con lo stesso nome su Drive (ambiguo: warning)
const norm = (s) => s.normalize('NFC').toLowerCase().replace(/['’`]/g, '_').replace(/\s+/g, ' ').trim();
const noExt = (s) => s.replace(/\.(jpe?g|png|heic|heif|webp|gif|tiff?)$/i, '');

export function createMatcher(files) {
  const exact = new Map();
  const loose = new Map();   // norm(path) → [files]
  const looser = new Map();  // norm(noExt(path)) → [files]
  const add = (m, k, f) => (m.get(k) || m.set(k, []).get(k)).push(f);
  const sorted = [...files].sort((a, b) => (a.modifiedTime || '').localeCompare(b.modifiedTime || '') || a.id.localeCompare(b.id));
  for (const f of sorted) {
    if (!exact.has(f.path)) exact.set(f.path, f); // tra omonimi vince il primo, come in loose[0]
    add(loose, norm(f.path), f);
    add(looser, norm(noExt(f.path)), f);
  }

  /** Ritorna { file, note } oppure null. `note` è valorizzata se l'associazione è ambigua. */
  return function match(p) {
    if (exact.has(p)) return { file: exact.get(p) };
    const a = loose.get(norm(p));
    if (a) return { file: a[0], note: a.length > 1 ? `${a.length} file con lo stesso nome su Drive, uso il primo` : null };
    const b = looser.get(norm(noExt(p)));
    if (b) return { file: b[0], note: b.length > 1 ? `${b.length} file con lo stesso nome su Drive, uso il primo` : null };
    const m = noExt(p).match(/^(.*?)\s*\((\d+)\)$/);
    if (m) {
      const c = looser.get(norm(m[1]));
      const n = Number(m[2]);
      if (c && c[n]) return { file: c[n], note: `"(${n})" associato al ${n + 1}° file omonimo su Drive (rinominare i file su Drive per evitare ambiguità)` };
      if (c) return { file: c[c.length - 1], note: `"(${n})": su Drive ci sono solo ${c.length} file omonimi, uso l'ultimo` };
    }
    return null;
  };
}
