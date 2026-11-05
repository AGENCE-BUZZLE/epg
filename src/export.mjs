// Export XMLTV du guide fusionné (pour Kodi, TiviMate, Plex… et pour les apps qui lisent ce format).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const t = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';

export function toXmltv(channels) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="epg-open">'];
  for (const c of channels) out.push(`  <channel id="${esc(c.id)}"><display-name>${esc(c.name)}</display-name>${c.logo ? `<icon src="${esc(c.logo)}"/>` : ''}</channel>`);
  for (const c of channels) {
    for (const p of c.progs) {
      const parts = [`<title>${esc(p.t)}</title>`];
      if (p.st) parts.push(`<sub-title>${esc(p.st)}</sub-title>`);
      if (p.d) parts.push(`<desc>${esc(p.d)}</desc>`);
      for (const cat of p.c || []) parts.push(`<category>${esc(cat)}</category>`);
      if (p.i) parts.push(`<icon src="${esc(p.i)}"/>`);
      if (p.ep) parts.push(`<episode-num system="onscreen">${p.ep.season ? `S${p.ep.season}` : ''}${p.ep.episode ? `E${p.ep.episode}` : ''}</episode-num>`);
      if (p.rerun) parts.push('<previously-shown/>');
      if (p.r) parts.push(`<rating><value>${esc(p.r)}</value></rating>`);
      out.push(`  <programme start="${t(p.s)}" stop="${t(p.e)}" channel="${esc(c.id)}">${parts.join('')}</programme>`);
    }
  }
  out.push('</tv>');
  return out.join('\n');
}
