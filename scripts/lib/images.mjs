// Elaborazione immagini: HEIC→JPG (heic-convert, JS puro), resize + miniatura con sharp.
import sharp from 'sharp';
import heicConvert from 'heic-convert';

// Cambia questo valore se modifichi i parametri: invalida le versioni elaborate in cache.
export const PROCESS_VERSION = 1;
export const FULL_MAX = 1600;
export const THUMB_MAX = 400;
export const QUALITY = 80;

sharp.cache(false);

function isHeic(buf, name = '') {
  if (/\.(heic|heif)$/i.test(name)) return true;
  // ftyp box: "....ftypheic" / "ftypheix" / "ftypmif1" ecc.
  const brand = buf.subarray(4, 12).toString('latin1');
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand);
}

async function toDecodable(buf, name) {
  if (!isHeic(buf, name)) return buf;
  return Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.95 }));
}

async function resize(input, max, quality) {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate() // applica orientamento EXIF
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Ritorna { full, thumb } (ognuno {data,width,height}); thumb solo se richiesto. */
export async function processImage(buf, name, { thumb = true } = {}) {
  const input = await toDecodable(buf, name);
  const full = await resize(input, FULL_MAX, QUALITY);
  const t = thumb ? await resize(input, THUMB_MAX, 75) : null;
  return { full, thumb: t };
}
