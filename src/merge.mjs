// Identité des chaînes entre sources, puis fusion des programmes chaîne par chaîne.
import { words, fold } from './util.mjs';

const QUALITY = new Set(['hd', 'fhd', 'uhd', '4k', 'sd', 'hevc', 'h265', 'h264', 'tv']);

/**
 * Clé d'une chaîne : « TF1 HD », « TF1.fr » et « tf1 » donnent « tf1 » ; « Canal+ Sport » et « CanalPlusSport.fr »
 * donnent « canalplussport ». « tv » est retiré sauf s'il est seul ou collé à un chiffre (« TV5 »).
 */
export function chanKey(raw, isId = false) {
  let s = String(raw || '');
  if (isId) s = s.replace(/\.[a-z]{2,3}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' ');
  // préfixe de langue ajouté par certaines sources (« ar: MBC 1 », « en: … »)
  s = s.replace(/^\s*[a-z]{2,3}\s*:\s*/i, '');
  const w = words(s);
  let kept = w.filter((x) => !QUALITY.has(x));
  // « One TV » ne doit pas devenir « one » (collision avec « ON E ») : « tv » n'est retiré que si la clé reste longue
  if (kept.join('').length < 4) kept = w.filter((x) => x === 'tv' || !QUALITY.has(x));
  const key = (kept.length ? kept : w).join('');
  // une clé sans aucune lettre (« 1 ») relierait des chaînes sans rapport
  return /\p{L}/u.test(key) ? key : '';
}

/** identifiant au format XMLTV/iptv-org (« TF1.fr », « France.3.Corse.fr ») ou opaque (« FRBC4300004F2 ») */
const readableId = (id) => /^[A-Za-z0-9+&'_-]+(\.[A-Za-z0-9+&'_-]+)*\.[a-z]{2}$/.test(id) && !/\d{5,}/.test(id);

const ccOf = (id) => (readableId(id) ? id.slice(id.lastIndexOf('.') + 1).toLowerCase() : '');
/** deux identifiants lisibles de pays différents (« Arte.fr » et « Arte.be ») */
const otherCountry = (a, b) => !!ccOf(a) && !!ccOf(b) && ccOf(a) !== ccOf(b);

/**
 * Regroupe les chaînes de toutes les sources : même clé (par l'identifiant ou par un nom) = même chaîne.
 * @param {{ code: string, onlyKnown?: boolean, channels: Map }[]} parsed sources dans l'ordre de priorité
 * @returns {{ groups: object[], bySourceChannel: Map<string, object> }}
 */
export function groupChannels(parsed, cc = 'fr') {
  const local = new RegExp(`\\.${cc}$`, 'i');
  const localName = cc === 'fr' ? /\bfr(ance)?\b/i : /$^/;
  const keyToGroup = new Map();
  const groups = [];
  const bySourceChannel = new Map();
  for (const src of parsed) {
    for (const ch of src.channels.values()) {
      const keys = new Set();
      // identifiant d'un autre pays (« Arte.be » dans le guide France) : sa clé garde le pays, sinon « arte » de Belgique
      // prenait la place d'Arte France (05/11/2026)
      if (readableId(ch.id)) {
        const k = chanKey(ch.id, true);
        const cc2 = ch.id.slice(ch.id.lastIndexOf('.') + 1).toLowerCase();
        if (k && !local.test(ch.id)) keys.add(`${k}@${cc2}`);
        keys.add(k);
      }
      for (const n of ch.names) keys.add(chanKey(n));
      for (const k of [...keys]) if (k.length < 2) keys.delete(k);
      let g = null;
      for (const k of keys) {
        const cand = keyToGroup.get(k);
        // une même source qui donne deux pays différents (« Arte.fr », « Arte.be ») : deux chaînes distinctes
        if (cand && !cand.members.some((m) => m.src === src.code && otherCountry(m.id, ch.id))) {
          g = cand;
          break;
        }
      }
      if (!g) {
        if (src.onlyKnown && !local.test(ch.id) && !ch.names.some((n) => localName.test(n))) continue;
        g = {
          id: readableId(ch.id) ? ch.id : `${src.code}.${ch.id}`,
          name: ch.names[0],
          names: new Set(),
          keys: new Set(),
          logo: undefined,
          members: [],
        };
        groups.push(g);
      }
      // une même source peut avoir deux variantes d'une chaîne (« TF1 », « TF1 HD ») : on garde la première
      if (!g.members.some((m) => m.src === src.code)) g.members.push({ src: src.code, id: ch.id });
      bySourceChannel.set(`${src.code}|${ch.id}`, g);
      for (const n of ch.names) g.names.add(n);
      for (const k of keys) {
        g.keys.add(k);
        // un nom commun (« rtl ») revient à la chaîne du pays du guide, même si celle d'un autre pays est arrivée avant
        const had = keyToGroup.get(k);
        if (!had || (had !== g && local.test(g.id) && !local.test(had.id))) keyToGroup.set(k, g);
      }
      if (!g.logo && ch.icon) g.logo = ch.icon;
    }
  }
  return { groups, bySourceChannel, keyToGroup };
}

/** clé d'un titre pour comparer deux sources (« Football : Ligue Europa | A / B » et « Football : Ligue Europa ») */
export function titleKey(t) {
  return words(t).join(' ').slice(0, 40);
}
const sameTitle = (a, b) => {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 6 && y.startsWith(x)) || (y.length >= 6 && x.startsWith(y));
};

/** premier indice dont le début est ≥ t (liste triée par début) */
function lowerBound(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** programmes qui commencent entre t-tol et t+tol */
function near(list, t, tol) {
  const out = [];
  for (let i = lowerBound(list, t - tol); i < list.length && list[i].s <= t + tol; i++) out.push(list[i]);
  return out;
}

/** minutes couvertes entre a et b */
function coverage(list, a, b) {
  let m = 0;
  for (const p of list) m += Math.max(0, Math.min(p.e, b) - Math.max(p.s, a));
  return m / 60_000;
}

/** chevauchement total (ms) d'un créneau avec une liste triée sans chevauchements */
function overlapWith(list, s, e) {
  let o = 0;
  for (let i = Math.max(0, lowerBound(list, s) - 1); i < list.length && list[i].s < e; i++) o += Math.max(0, Math.min(e, list[i].e) - Math.max(s, list[i].s));
  return o;
}

/** retire les chevauchements d'une liste (garde le premier programme), trie par début */
export function clean(list) {
  const sorted = [...list].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.s < last.e) {
      if (p.e <= last.e) continue; // programme inclus dans le précédent
      if (last.e - p.s > 5 * 60_000) continue; // vrai conflit : on garde le premier
      p.s = last.e; // léger chevauchement : on recale
    }
    if (p.e > p.s) out.push(p);
  }
  return out;
}

/**
 * Décalage constant d'une source par rapport à une autre (titres identiques décalés d'un nombre entier d'heures) :
 * c'est l'erreur de fuseau ou de changement d'heure typique. Renvoie le décalage en minutes, ou 0.
 */
export function detectOffset(ref, other) {
  const diffs = [];
  for (const p of other) {
    for (const q of near(ref, p.s, 3 * 3600_000)) if (sameTitle(p.t, q.t)) diffs.push(Math.round((p.s - q.s) / 60_000));
  }
  if (diffs.length < 4) return 0;
  const count = new Map();
  for (const d of diffs) count.set(d, (count.get(d) || 0) + 1);
  const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best !== 0 && best % 30 === 0 && n / diffs.length >= 0.7 && (count.get(0) || 0) / diffs.length < 0.2) return best;
  return 0;
}

const FIELDS = ['st', 'd', 'i', 'ep', 'r', 'c'];

/**
 * Fusionne les programmes d'une chaîne venant de plusieurs sources.
 * 1. la source qui couvre le mieux les 48 h à venir sert de base ;
 * 2. une source décalée d'un nombre d'heures entier est mise de côté pour cette chaîne (signalée) ;
 * 3. les trous de la base sont comblés par les autres sources (jamais par un programme inventé) ;
 * 4. chaque programme récupère les champs qui lui manquent (image, description, épisode…) chez les autres
 *    sources quand elles ont le même programme à la même heure ; `n` = nombre de sources d'accord.
 * @param {{ src: string, progs: object[] }[]} lists dans l'ordre de priorité
 */
export function mergeChannel(lists, now = Date.now()) {
  const usable = lists.map((l) => ({ src: l.src, progs: clean(l.progs) })).filter((l) => l.progs.length);
  if (!usable.length) return { progs: [], primary: null, offsets: [] };
  const a = now;
  const b = now + 48 * 3600_000;
  const base = usable.reduce((best, l) => (coverage(l.progs, a, b) > coverage(best.progs, a, b) + 30 ? l : best), usable[0]);
  const offsets = [];
  const others = [];
  for (const l of usable) {
    if (l === base) continue;
    const off = detectOffset(base.progs, l.progs);
    if (off) offsets.push({ src: l.src, minutes: off });
    else others.push(l);
  }
  const merged = base.progs.map((p) => ({ ...p, src: base.src, n: 1 }));
  for (const l of others) {
    for (const p of l.progs) {
      const len = p.e - p.s;
      if (overlapWith(merged, p.s, p.e) <= Math.min(5 * 60_000, len * 0.1)) {
        const idx = lowerBound(merged, p.s);
        merged.splice(idx, 0, { ...p, src: l.src, n: 1, fill: 1 });
      }
    }
  }
  const final = clean(merged);
  const imgsOf = (q) => q.imgs || (q.i ? [q.i] : []);
  for (const p of final) {
    // toutes les images proposées pour ce programme (source retenue d'abord) : le choix horizontal se fait ensuite
    // (src/images.mjs) ; `i` garde l'image de l'ancienne règle (première image de la source retenue)
    const imgs = [...imgsOf(p)];
    for (const l of others) {
      if (l.src === p.src) continue;
      const twin = near(l.progs, p.s, 10 * 60_000).find((q) => sameTitle(p.t, q.t));
      if (!twin) continue;
      p.n++;
      for (const u of imgsOf(twin)) if (!imgs.includes(u)) imgs.push(u);
      for (const f of FIELDS) if (p[f] === undefined && twin[f] !== undefined) p[f] = twin[f];
      if (twin.d && p.d && twin.d.length > p.d.length * 1.5) p.d = twin.d;
    }
    if (imgs.length) p.imgs = imgs;
    else delete p.imgs;
  }
  return { progs: final, primary: base.src, offsets };
}

export { fold };

/**
 * Historique pour le replay (05/11/2026) : les sources ne remontent qu'à la veille. On garde les programmes passés de la
 * génération précédente (fichier de la chaîne publié) qui précèdent le premier programme frais, sur `days` jours.
 * @param {{ s: number, e: number }[]} prev programmes publiés la fois d'avant (format du fichier de chaîne)
 * @param {{ s: number, e: number }[]} fresh programmes de cette génération, triés
 */
export function keepPast(prev, fresh, now = Date.now(), days = 7) {
  if (!Array.isArray(prev) || !prev.length) return fresh;
  const first = fresh.length ? fresh[0].s : Infinity;
  const from = now - days * 24 * 3600_000;
  const past = prev.filter((p) => p && typeof p.s === 'number' && typeof p.e === 'number' && p.e > from && p.e <= first && p.s < first);
  return past.length ? [...past.sort((a, b) => a.s - b.s), ...fresh] : fresh;
}
