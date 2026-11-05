// Lecture des fichiers XMLTV : chaînes et programmes, heures converties en UTC (millisecondes).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescape = (s) =>
  String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()],
  );

/**
 * Heure XMLTV → millisecondes UTC. « 20261104002500 +0100 » = 00 h 25 à Paris en hiver = 23 h 25 UTC la veille.
 * Sans décalage écrit, la norme XMLTV dit UTC : on renvoie aussi `noOffset` pour que l'appelant le sache.
 */
export function parseTime(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(String(v || '').trim());
  if (!m) return { ms: NaN, noOffset: true };
  const [, y, mo, d, h = '0', mi = '0', s = '0', sign, oh, om] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (sign) ms -= (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60_000;
  return { ms, noOffset: !sign };
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag) || new RegExp(`\\b${name}='([^']*)'`).exec(tag);
  return m ? unescape(m[1]) : undefined;
};
const inner = (body, tag) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? unescape(m[1].trim()) : undefined;
};
const all = (body, tag) => [...body.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => unescape(m[1].trim()));

/** « 1.9. » (xmltv_ns, compté à partir de 0) ou « S02E05 » / « E56 » (onscreen) → { season, episode } */
export function parseEpisode(body) {
  const ns = /<episode-num[^>]*system="xmltv_ns"[^>]*>([^<]*)</.exec(body);
  if (ns) {
    const [s, e] = ns[1].split('.').map((x) => x.split('/')[0].trim());
    const out = {};
    if (s !== '' && !isNaN(+s)) out.season = +s + 1;
    if (e !== '' && e !== undefined && !isNaN(+e)) out.episode = +e + 1;
    if (out.season || out.episode) return out;
  }
  const on = /<episode-num[^>]*system="onscreen"[^>]*>([^<]*)</.exec(body);
  if (on) {
    const m = /S(\d+)\s*E(\d+)/i.exec(on[1]) || /^E(\d+)$/i.exec(on[1].trim());
    if (m) return m.length === 3 ? { season: +m[1], episode: +m[2] } : { episode: +m[1] };
  }
  return undefined;
}

/**
 * Lit un XMLTV complet.
 * @returns {{ channels: Map<string, { id: string, names: string[], icon?: string }>, programmes: object[], noOffset: number }}
 */
export function parseXmltv(text) {
  const channels = new Map();
  for (const m of text.matchAll(/<channel\s+([^>]*)>([\s\S]*?)<\/channel>/g)) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const names = all(m[2], 'display-name').filter(Boolean);
    const icon = /<icon[^>]*\bsrc="([^"]+)"/.exec(m[2]);
    channels.set(id, { id, names: names.length ? names : [id], icon: icon ? unescape(icon[1]) : undefined });
  }
  const programmes = [];
  let noOffset = 0;
  for (const m of text.matchAll(/<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const head = m[1];
    const body = m[2];
    const ch = attr(head, 'channel');
    const a = parseTime(attr(head, 'start'));
    const b = parseTime(attr(head, 'stop'));
    if (!ch || !Number.isFinite(a.ms) || !Number.isFinite(b.ms) || b.ms <= a.ms) continue;
    if (a.noOffset) noOffset++;
    const icon = /<icon[^>]*\bsrc="([^"]+)"/.exec(body);
    const rating = /<rating[^>]*>\s*<value>([^<]*)<\/value>/.exec(body);
    const p = {
      ch,
      s: a.ms,
      e: b.ms,
      t: inner(body, 'title') || '',
    };
    const st = inner(body, 'sub-title');
    const d = inner(body, 'desc');
    const cat = [...new Set(all(body, 'category'))];
    const ep = parseEpisode(body);
    if (st) p.st = st;
    if (d) p.d = d;
    if (icon) p.i = unescape(icon[1]);
    if (cat.length) p.c = cat;
    if (ep) p.ep = ep;
    if (rating) p.r = unescape(rating[1].trim());
    if (/<previously-shown/.test(body)) p.rerun = 1;
    if (/<live\s*\/?>/.test(body)) p.live = 1;
    if (/<premiere/.test(body)) p.new = 1;
    programmes.push(p);
  }
  return { channels, programmes, noOffset };
}
