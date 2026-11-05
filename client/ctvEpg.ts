/**
 * Client du guide TV ouvert (dépôt AGENCE-BUZZLE/epg), prêt à copier dans l'app CTV+ (src/lib/ctvEpg.ts).
 * Sans dépendance : seulement `fetch`. Fonctionne en React Native (iOS, tvOS, Android), en Electron et dans Node.
 *
 * - `load()` charge les alias de chaînes et le fichier « en cours » (toutes les chaînes, −1 h à +9 h) ;
 * - `match()` relie une chaîne du fournisseur (« FR| TF1 FHD ᴿᴬᵂ », tvg-id « TF1.fr ») à une chaîne du guide ;
 * - `nowNext()` donne le programme en cours et les suivants, à l'heure CORRIGÉE (horloge de la box fausse) ;
 * - `channel()` charge ~10 jours de programmes d'une chaîne (grille, fiche, replay) ;
 * - `sport()` donne les matchs avec les chaînes qui les diffusent VRAIMENT (`tv`), jamais les annonces non vérifiées.
 *
 * Toutes les heures sont en millisecondes UTC : afficher avec `Intl.DateTimeFormat` (fuseau de l'appareil),
 * jamais de « +1 h » calculé à la main.
 *
 * ⚠️ `channelKey` doit rester identique à `chanKey` de src/merge.mjs (même normalisation des deux côtés).
 */

export const EPG_BASE = 'https://raw.githubusercontent.com/AGENCE-BUZZLE/epg/data';

export type Programme = {
  s: number; // début (ms UTC)
  e: number; // fin (ms UTC)
  t: string; // titre
  st?: string; // sous-titre
  d?: string; // description (fichier de chaîne seulement)
  i?: string; // image 16:9
  c?: string | string[]; // catégorie (première dans « en cours », toutes dans le fichier de chaîne)
  ep?: { season?: number; episode?: number };
  r?: string; // classification (CSA…)
  rerun?: 1;
  live?: 1;
  new?: 1;
};

export type Broadcast = { ch: string; name: string; s: number; e: number; t: string; st?: string; live: boolean; niveau: 'confirmé' | 'probable'; multiplex?: boolean };
export type SportEvent = {
  id: string;
  sport: string;
  competition?: string;
  name: string;
  start: number;
  end?: number;
  status?: string;
  statusText?: string;
  home?: { name: string; short?: string; abbr?: string; logo?: string; score?: string };
  away?: { name: string; short?: string; abbr?: string; logo?: string; score?: string };
  /** chaînes qui ont vraiment le match au guide : SEULE liste à afficher comme diffuseurs */
  tv: Broadcast[];
  rediffusions?: Broadcast[];
  /** diffuseurs annoncés par ESPN (souvent américains) : ne pas afficher, sauf dansLeGuide */
  announced: { name: string; type: 'tv' | 'streaming'; dansLeGuide: boolean; ch?: string }[];
  verifie: boolean;
  source?: 'guide';
};

// ── normalisation des noms (identique à src/util.mjs + src/merge.mjs) ─────────────────────────────────────────

const fold = (s: string) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ');
const words = (s: string) => fold(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const QUALITY = new Set(['hd', 'fhd', 'uhd', '4k', 'sd', 'hevc', 'h265', 'h264', 'tv']);

/** même clé que le serveur (chanKey) */
export function channelKey(raw: string, isId = false): string {
  let s = String(raw || '');
  if (isId) s = s.replace(/\.[a-z]{2,3}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' ');
  s = s.replace(/^\s*[a-z]{2,3}\s*:\s*/i, '');
  const w = words(s);
  let kept = w.filter((x) => !QUALITY.has(x));
  if (kept.join('').length < 4) kept = w.filter((x) => x === 'tv' || !QUALITY.has(x));
  const key = (kept.length ? kept : w).join('');
  return /\p{L}/u.test(key) ? key : '';
}

/** mots ajoutés par les fournisseurs IPTV, sans rapport avec la chaîne */
const PROVIDER_NOISE = new Set(['raw', 'backup', 'vip', 'multi', 'fhd', 'uhd', 'hd', 'sd', '4k', '8k', 'hevc', 'h265', 'h264', '50fps', '60fps', 'fps', 'low', 'lq', 'hq', 'hdr', 'sdr', 'dolby', 'vision', 'atmos', 'test']);

/**
 * Nettoie un nom de chaîne de fournisseur : « FR| TF1 FHD ᴿᴬᵂ » → « TF1 », « |FR| CANAL+ SPORT 360 HD » →
 * « CANAL+ SPORT 360 », « FR: M6 (backup) » → « M6 », « TF1 [FR] » → « TF1 ».
 */
export function cleanProviderName(raw: string): string {
  let s = String(raw || '').normalize('NFKC'); // ᴿᴬᵂ → RAW, ＦＨＤ → FHD
  s = s.replace(/^\s*(?:[|[(]?\s*[A-Z]{2,3}(?:-[A-Z]{2,3})?\s*[|\])]|[A-Z]{2,3}\s*[:|»>-])\s*/u, ''); // « FR| », « |FR| », « [FR] », « FR: »
  s = s.replace(/[[(][^\])]*[\])]/g, ' '); // (backup), [FR], (1080p)…
  s = s.replace(/\b\d{3,4}p\b/gi, ' ');
  const kept = s.split(/\s+/).filter((w) => w && !PROVIDER_NOISE.has(fold(w).replace(/[^a-z0-9]/g, '')));
  return kept.join(' ').trim() || String(raw || '').trim();
}

// ── client ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Opts = { base?: string; country?: string; fetchImpl?: typeof fetch; now?: () => number };

export class CtvEpg {
  private base: string;
  private country: string;
  private fetchImpl: typeof fetch;
  private clock: () => number;
  private skew = 0; // heure du serveur − heure de l'appareil (ms)
  private aliases = new Map<string, string>();
  private ids = new Set<string>();
  private nowData: Record<string, Programme[]> = {};
  private nowAt = 0;
  private channelCache = new Map<string, { at: number; progs: Programme[] }>();
  private sportCache?: { at: number; events: SportEvent[] };

  constructor(opts: Opts = {}) {
    this.base = (opts.base || EPG_BASE).replace(/\/+$/, '');
    this.country = opts.country || 'fr';
    this.fetchImpl = opts.fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.clock = opts.now || (() => Date.now());
  }

  /** heure « vraie » : l'horloge de l'appareil corrigée par l'en-tête Date du serveur */
  now(): number {
    return this.clock() + this.skew;
  }

  private async get<T>(path: string): Promise<T> {
    const r = await this.fetchImpl(`${this.base}/${path}`);
    if (!r.ok) throw new Error(`guide ${path} : HTTP ${r.status}`);
    const date = Date.parse(r.headers.get('date') || '');
    // n'a de sens que si l'écart dépasse la précision de l'en-tête (1 s) et le temps de la requête
    if (Number.isFinite(date)) {
      const d = date - this.clock();
      this.skew = Math.abs(d) > 90_000 ? d : 0;
    }
    return (await r.json()) as T;
  }

  /** à appeler au démarrage du direct, puis toutes les 30 min environ */
  async load(): Promise<void> {
    const [a, n] = await Promise.all([
      this.aliases.size ? Promise.resolve(null) : this.get<{ aliases: Record<string, string> }>(`${this.country}/aliases.json`),
      this.get<{ generatedAt: number; channels: Record<string, Programme[]> }>(`${this.country}/now.json`),
    ]);
    if (a) {
      for (const [k, id] of Object.entries(a.aliases)) this.aliases.set(k, id);
      for (const id of Object.values(a.aliases)) this.ids.add(id);
    }
    this.nowData = n.channels;
    this.nowAt = this.clock();
  }

  /** le fichier « en cours » a-t-il besoin d'être rechargé ? (couvre 9 h, rechargé toutes les 30 min par prudence) */
  stale(): boolean {
    return this.clock() - this.nowAt > 30 * 60_000;
  }

  /**
   * Chaîne du guide correspondant à une chaîne du fournisseur, ou undefined (alors : guide du fournisseur en secours).
   * Ordre : tvg-id / epg_channel_id, puis nom nettoyé, puis nom brut.
   */
  match(ch: { name: string; epgId?: string }): string | undefined {
    if (ch.epgId) {
      if (this.ids.has(ch.epgId)) return ch.epgId;
      const k = channelKey(ch.epgId, /\.[a-z]{2,3}$/i.test(ch.epgId));
      if (k && this.aliases.has(k)) return this.aliases.get(k);
    }
    for (const n of [cleanProviderName(ch.name), ch.name]) {
      const k = channelKey(n);
      if (k && this.aliases.has(k)) return this.aliases.get(k);
    }
    return undefined;
  }

  /** programme en cours, suivant, et la liste de la fenêtre (−1 h à +9 h) */
  nowNext(id: string): { cur?: Programme; next?: Programme; items: Programme[] } {
    const items = this.nowData[id] || [];
    const t = this.now();
    const cur = items.find((p) => p.s <= t && p.e > t);
    const next = items.find((p) => p.s >= (cur ? cur.e : t));
    return { cur, next, items };
  }

  /** ~10 jours de programmes d'une chaîne (cache 30 min) */
  async channel(id: string): Promise<Programme[]> {
    const hit = this.channelCache.get(id);
    if (hit && this.clock() - hit.at < 30 * 60_000) return hit.progs;
    const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
    const d = await this.get<{ programmes: Programme[] }>(`${this.country}/ch/${encodeURIComponent(safe)}.json`);
    this.channelCache.set(id, { at: this.clock(), progs: d.programmes });
    if (this.channelCache.size > 60) this.channelCache.delete(this.channelCache.keys().next().value as string);
    return d.programmes;
  }

  /** matchs en cours et à venir (cache 30 min). N'afficher comme diffuseurs que `tv` ; `announced` = non vérifié. */
  async sport(): Promise<SportEvent[]> {
    if (this.sportCache && this.clock() - this.sportCache.at < 30 * 60_000) return this.sportCache.events;
    const d = await this.get<{ events: SportEvent[] }>('sport/events.json');
    this.sportCache = { at: this.clock(), events: d.events };
    return d.events;
  }
}
