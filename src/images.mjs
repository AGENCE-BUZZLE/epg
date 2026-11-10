// Images des programmes (10/11/2026) : les cartes de l'app sont en 16:9, or beaucoup de sources donnent des affiches
// verticales (SFR 600×800). Pour chaque programme on rassemble toutes les images proposées (plusieurs par source chez
// epgshare01, et celles des autres sources pour le même créneau), on connaît leur format (d'après l'adresse quand elle
// le dit, sinon en lisant seulement l'en-tête du fichier, avec un cache d'une génération à l'autre) et on garde en
// priorité une image horizontale. Le format retenu est publié dans `ir` (largeur / hauteur, 2 décimales).
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';

/** à partir de ce rapport largeur / hauteur, une image est « horizontale » (16:9 = 1,78 ; 3:2 = 1,5 n'en est pas) */
export const WIDE = 1.6;
const DAY = 24 * 3600_000;
const UA = 'Mozilla/5.0 (compatible; epg-open/0.1; +https://github.com/AGENCE-BUZZLE/epg)';

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Adresse d'image propre, ou undefined pour une image vide connue.
 * epgshare01 écrit parfois « https://television.telerama.frhttps://focus.telerama.fr/… » : on garde la vraie adresse.
 */
export function cleanImageUrl(u) {
  let s = String(u || '').trim();
  const twice = Math.max(s.lastIndexOf('http://'), s.lastIndexOf('https://'));
  if (twice > 0) s = s.slice(twice);
  if (!/^https?:\/\/[^/]+\/./.test(s)) return undefined;
  // images vides (pixel transparent de Télérama, image « 0 » de Nealis)
  if (/\/clear-\d+\.png$/i.test(s) || /img\.nealis\.fr\/.*\/0\/0\.png$/i.test(s)) return undefined;
  return s;
}

/**
 * Format d'une image d'après son adresse, quand l'adresse l'impose (redimensionneurs) : largeur / hauteur, ou undefined.
 *   thumb.canalplus.pro/…/640x360/…, programme-tv.net/…/640x360/…, focus.telerama.fr/252x168/…, …-768x432.png,
 *   img*.oqee.net/…/wide_generic/…, _ipx/…,w_1280,h_720/…, images.pluto.tv …?w=900&h=900&fit=fill
 */
export function urlRatio(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return undefined;
  }
  if (/(^|\.)oqee\.net$/.test(url.hostname) && /\/wide_generic\//.test(url.pathname)) return round2(16 / 9);
  // paramètres de redimensionnement (imgix, Pluto) : seulement si l'image est remplie ou recadrée à la taille demandée
  const w = +url.searchParams.get('w');
  const h = +url.searchParams.get('h');
  if (w > 0 && h > 0 && /^(fill|crop)$/.test(url.searchParams.get('fit') || '')) return round2(w / h);
  const ipx = /[/,]w_(\d+),h_(\d+)[/,]/.exec(url.pathname);
  if (ipx && +ipx[1] > 0 && +ipx[2] > 0) return round2(+ipx[1] / +ipx[2]);
  // « 640x360 » comme segment de chemin, ou suffixe WordPress « -768x432.png »
  const seg = /(?:^|\/|-)(\d{2,4})x(\d{2,4})(?=\/|\.[a-z]{3,4}$)/i.exec(url.pathname);
  if (seg && +seg[1] > 0 && +seg[2] > 0) return round2(+seg[1] / +seg[2]);
  return undefined;
}

/**
 * Variantes horizontales d'une image, quand le serveur d'images sait les fabriquer (vérifié le 10/11/2026) :
 * - Télérama : « /252x168/ » (3:2, minuscule) → « /1280x720/ » (recadré proprement en 16:9) ;
 * - Pluto : la série ou l'épisode a souvent une « featuredImage » 16:9 (absente parfois : 404) → à vérifier par sondage ;
 *   sinon l'affiche carrée est redemandée en 1280×720 avec un fond flou (fill=blur&fit=fill), toujours valide.
 * @returns {{ u: string, r?: number, verify?: boolean }[]} dans l'ordre de préférence ; `verify` = à n'utiliser que si
 *   un sondage confirme que l'image existe
 */
export function variants(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return [];
  }
  if (url.hostname === 'focus.telerama.fr' && /^\/\d+x\d+\//.test(url.pathname)) {
    return [{ u: `${url.origin}${url.pathname.replace(/^\/\d+x\d+\//, '/1280x720/')}${url.search}`, r: round2(16 / 9) }];
  }
  if (url.hostname === 'images.pluto.tv' && /^\/(series|episodes)\/[^/]+\/[^/]+$/.test(url.pathname)) {
    const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
    const out = [];
    if (!/\/featuredImage\.[a-z]+$/i.test(url.pathname)) out.push({ u: `${url.origin}${dir}/featuredImage.jpg?fm=jpg&q=75&w=1280&h=720&fit=crop`, verify: true });
    const q = new URLSearchParams(url.search);
    q.set('fill', 'blur');
    q.set('fit', 'fill');
    q.set('fm', q.get('fm') || 'jpg');
    q.set('q', q.get('q') || '75');
    q.set('w', '1280');
    q.set('h', '720');
    out.push({ u: `${url.origin}${url.pathname}?${q}`, r: round2(16 / 9) });
    return out;
  }
  return [];
}

/**
 * Dimensions d'une image d'après les premiers octets du fichier (JPEG, PNG, WebP, GIF), ou undefined.
 * @param {Uint8Array} b
 */
export function imageSize(b) {
  if (!b || b.length < 10) return undefined;
  // PNG : signature puis bloc IHDR
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
    return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  // WebP : RIFF….WEBP puis VP8 / VP8L / VP8X
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 && b.length >= 30) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (kind === 'VP8L') {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return undefined;
  }
  // JPEG : on saute les segments jusqu'au premier SOF (C0 à CF sauf C4, C8, CC)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return undefined;
}

/**
 * Sonde une image : télécharge seulement le début du fichier (requête Range, 32 Ko, puis jusqu'à 128 Ko si l'en-tête
 * JPEG est long) et en lit les dimensions. Renvoie le rapport largeur / hauteur, 0 si l'image est absente ou illisible,
 * undefined si le délai est dépassé (on réessaiera à la prochaine génération).
 */
export async function probeRatio(u, { timeoutMs = 6000, fetchImpl = fetch } = {}) {
  let r;
  try {
    r = await fetchImpl(u, { headers: { 'user-agent': UA, range: 'bytes=0-32767', accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return undefined;
  }
  if (r.status === 404 || r.status === 410) {
    r.body?.cancel().catch(() => {});
    return 0;
  }
  if (!r.ok) {
    r.body?.cancel().catch(() => {});
    return undefined;
  }
  const chunks = [];
  let len = 0;
  let size;
  try {
    // un serveur qui ignore Range renvoie tout le fichier : on s'arrête dès que les dimensions sont lues
    const reader = r.body.getReader();
    while (len < 131072) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      len += value.length;
      if (len >= 64) {
        size = imageSize(Buffer.concat(chunks));
        if (size) break;
      }
    }
    reader.cancel().catch(() => {});
  } catch {
    if (!size) return undefined;
  }
  if (!size) size = imageSize(Buffer.concat(chunks));
  // en-tête JPEG plus long que 32 Ko (gros profil couleur) : on redemande la suite une fois
  if (!size && r.status === 206 && len >= 32768) {
    try {
      const r2 = await fetchImpl(u, { headers: { 'user-agent': UA, range: 'bytes=0-131071' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (r2.ok) size = imageSize(Buffer.from(await r2.arrayBuffer()));
    } catch {
      return undefined;
    }
  }
  return size && size.w > 0 && size.h > 0 ? round2(size.w / size.h) : 0;
}

/**
 * Cache des formats d'image, gardé d'une génération à l'autre (publié dans la branche data, relu via --prev) :
 * adresse → [rapport (0 = absente ou illisible), jour du dernier usage]. Les échecs sont réessayés après 2 jours,
 * les adresses inutilisées depuis 21 jours sont oubliées.
 */
export class RatioCache {
  constructor(now = Date.now()) {
    this.now = now;
    this.today = Math.floor(now / DAY);
    this.map = new Map();
    this.probed = 0;
    this.loaded = 0;
  }

  load(path) {
    if (!path || !existsSync(path)) return this;
    try {
      const j = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
      for (const [u, v] of Object.entries(j.images || {})) if (Array.isArray(v) && typeof v[0] === 'number') this.map.set(u, [v[0], v[1] | 0]);
      this.loaded = this.map.size;
    } catch {
      // cache illisible : on repart de zéro
    }
    return this;
  }

  /** rapport connu (0 = absente), ou undefined s'il faut sonder */
  get(u) {
    const v = this.map.get(u);
    if (!v) return undefined;
    if (v[0] === 0 && this.today - v[1] >= 2) return undefined;
    v[1] = v[0] === 0 ? v[1] : this.today;
    return v[0];
  }

  set(u, r) {
    this.map.set(u, [r, this.today]);
  }

  toGzip() {
    const images = {};
    for (const [u, v] of this.map) if (this.today - v[1] <= 21) images[u] = v;
    return gzipSync(JSON.stringify({ generatedAt: this.now, note: 'adresse → [largeur/hauteur (0 = absente), jour depuis 1970 du dernier usage]', images }));
  }
}

/**
 * Candidates d'un programme, dans l'ordre de préférence : chaque image proposée, précédée de ses variantes horizontales.
 * @param {string[]} imgs images proposées (source retenue d'abord, puis les autres sources)
 * @param {Map<string, number>} hints formats écrits dans le XMLTV (attributs width / height)
 */
export function candidates(imgs, hints = new Map()) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (seen.has(c.u)) return;
    seen.add(c.u);
    out.push(c);
  };
  for (const raw of imgs) {
    const u = cleanImageUrl(raw);
    if (!u) continue;
    for (const v of variants(u)) add(v);
    add({ u, r: hints.get(u) ?? urlRatio(u) });
  }
  return out;
}

/** format d'une candidate : connu par l'adresse, sinon par le cache (undefined = inconnu, 0 = absente) */
const ratioOf = (c, cache) => (c.r !== undefined ? c.r : cache.get(c.u));

/**
 * Adresses à sonder pour bien choisir : toutes les candidates de format inconnu qui passent avant la première
 * candidate horizontale connue.
 */
export function toProbe(cands, cache) {
  const out = [];
  for (const c of cands) {
    const r = ratioOf(c, cache);
    if (r === undefined) out.push(c.u);
    else if (r >= WIDE) break;
  }
  return out;
}

/**
 * Choix de l'image : la première horizontale (≥ 1,6) dans l'ordre de préférence, sinon la plus large connue ; une
 * image de format inconnu compte comme carrée (elle reste choisie si rien de mieux n'est connu). Une variante à vérifier
 * n'est retenue que si un sondage l'a trouvée.
 * @returns {{ i?: string, ir?: number }}
 */
export function pickImage(cands, cache) {
  let best;
  let bestScore = -1;
  for (const c of cands) {
    const r = ratioOf(c, cache);
    if (c.verify && !(r > 0)) continue;
    if (r === 0) continue; // image absente (404) ou illisible
    if (r !== undefined && r >= WIDE) return { i: c.u, ir: r };
    const score = r ?? 1;
    if (score > bestScore) {
      best = { i: c.u, ...(r !== undefined ? { ir: r } : {}) };
      bestScore = score;
    }
  }
  if (best) return best;
  // toutes absentes d'après le cache : on garde la première image d'origine plutôt que rien
  const first = cands.find((c) => !c.verify);
  return first ? { i: first.u } : {};
}

/**
 * Sonde une liste d'adresses en parallèle limité, sans dépasser le délai total : ce qui n'a pas été sondé le sera à la
 * prochaine génération (le cache garde tout).
 */
export async function probeAll(urls, cache, { concurrency = 12, budgetMs = 150_000, timeoutMs = 6000, fetchImpl, log = () => {} } = {}) {
  const deadline = Date.now() + budgetMs;
  let k = 0;
  let done = 0;
  let failed = 0;
  let timedOut = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (k < urls.length && Date.now() < deadline) {
        const u = urls[k++];
        const r = await probeRatio(u, { timeoutMs: Math.min(timeoutMs, Math.max(500, deadline - Date.now())), fetchImpl });
        if (r === undefined) timedOut++;
        else {
          cache.set(u, r);
          if (r === 0) failed++;
        }
        done++;
        if (done % 2000 === 0) log(`Images : ${done}/${urls.length} sondées`);
      }
    }),
  );
  cache.probed += done;
  return { asked: urls.length, probed: done, failed, timedOut, skipped: urls.length - done };
}
