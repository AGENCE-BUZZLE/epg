// Outils communs : téléchargement (gzip ou non, essais répétés), normalisation des noms, comparaison de mots.
import { gunzipSync } from 'node:zlib';

const UA = 'Mozilla/5.0 (compatible; epg-open/0.1; +https://github.com/AGENCE-BUZZLE/epg)';

/** Télécharge une adresse (ou la suivante de la liste si elle échoue) et renvoie le texte, dégzippé si besoin. */
export async function fetchText(urls, { timeoutMs = 120_000, tries = 3 } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  let last;
  for (const url of list) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        let buf = Buffer.from(await r.arrayBuffer());
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
        return { text: buf.toString('utf8'), url };
      } catch (e) {
        last = new Error(`${url} : ${e.message}`);
        if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
    }
  }
  throw last;
}

export async function fetchJson(url, opts) {
  const { text } = await fetchText(url, opts);
  return JSON.parse(text);
}

/** minuscules, sans accents, « + » → « plus », « & » → « and » */
export function fold(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ');
}

/** mots significatifs (lettres et chiffres) */
export const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** distance d'édition (pour « Olympiakos » / « Olympiacos ») */
export function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0];
    p[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = p[j];
      p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return p[b.length];
}

/** identifiant utilisable dans une adresse de fichier */
export const safeId = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

/** limite le nombre de tâches simultanées */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
