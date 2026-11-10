// Images horizontales : format d'après l'adresse, en-tête des fichiers, choix, sondage, cache, fusion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanImageUrl, urlRatio, variants, imageSize, probeRatio, probeAll, RatioCache, candidates, pickImage, toProbe, WIDE } from '../src/images.mjs';
import { parseXmltv } from '../src/xmltv.mjs';
import { mergeChannel } from '../src/merge.mjs';

const NOW = Date.UTC(2026, 10, 10, 12);

/** faux en-têtes de fichiers */
const jpeg = (w, h, pad = 20) => {
  const app = Buffer.alloc(pad + 4);
  app[0] = 0xff;
  app[1] = 0xe0;
  app.writeUInt16BE(pad + 2, 2);
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof]);
};
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const webpX = (w, h) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0);
  b.write('WEBPVP8X', 8);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};

test('adresse : formats imposés par les redimensionneurs', () => {
  assert.equal(urlRatio('https://thumb.canalplus.pro/http/unsafe/640x360/filters:quality(80)/canalplus-cdn.canal-plus.io/p1/x/18f9'), 1.78);
  assert.equal(urlRatio('https://www.programme-tv.net/imgre/fit/~2~program~aedfda1a6c19ebb0.jpeg/640x360/quality/80/ferme-les-yeux.jpg'), 1.78);
  assert.equal(urlRatio('https://focus.telerama.fr/252x168/80/2026/10/16/b81e.jpg'), 1.5);
  assert.equal(urlRatio('https://img2.oqee.net/pictures/5112023/wide_generic/h1080'), 1.78);
  assert.equal(urlRatio('https://ipx-programmestv.sudinfo.be/_ipx/f_webp,sharpen_100,w_1280,h_720/ctr-img/x.jpg?tnjyz9'), 1.78);
  assert.equal(urlRatio('https://images.pluto.tv/series/6733/tile.jpg?fill=blur&fit=fill&fm=jpg&h=900&q=75&w=900'), 1);
  assert.equal(urlRatio('https://www.tebeo.bzh/wp-content/uploads/2023/05/VIGN_BB_2024-768x432.png'), 1.78);
  assert.equal(urlRatio('https://medias.france.tv/zpiH/2500x1406/filters:quality(85)/k/j/z/phpu88zjk.png'), 1.78);
  // hauteur 0 (« 650x0 ») ou rien dans l'adresse : inconnu, il faudra sonder
  assert.equal(urlRatio('https://medias.france.tv/hWXX/650x0/filters:quality(85):format(webp)/0/8/b/0cad.jpg'), undefined);
  assert.equal(urlRatio('http://static-cdn.tv.sfr.net/data/img/pl/9/6/7/15176769.jpg'), undefined);
  assert.equal(urlRatio('pas une adresse'), undefined);
});

test('adresse : réparée ou écartée', () => {
  assert.equal(cleanImageUrl('https://television.telerama.frhttps://focus.telerama.fr/252x168/80/a.jpg'), 'https://focus.telerama.fr/252x168/80/a.jpg');
  assert.equal(cleanImageUrl('https://television.telerama.frhttps://focus.telerama.fr/0000/00/01/clear-192.png'), undefined);
  assert.equal(cleanImageUrl('https://img.nealis.fr/ptv/img/p/g/0/0.png'), undefined);
  assert.equal(cleanImageUrl(''), undefined);
  assert.equal(cleanImageUrl(' http://static-cdn.tv.sfr.net/data/img/pl/1.jpg '), 'http://static-cdn.tv.sfr.net/data/img/pl/1.jpg');
});

test('variantes horizontales : Télérama 1280x720, Pluto featuredImage (à vérifier) puis fond flou 1280×720', () => {
  assert.deepEqual(variants('https://focus.telerama.fr/252x168/80/2026/10/16/b81e.jpg'), [{ u: 'https://focus.telerama.fr/1280x720/80/2026/10/16/b81e.jpg', r: 1.78 }]);
  const v = variants('https://images.pluto.tv/series/6733/tile_177.jpg?fill=blur&fit=fill&fm=jpg&h=900&q=75&w=900');
  assert.equal(v.length, 2);
  assert.deepEqual(v[0], { u: 'https://images.pluto.tv/series/6733/featuredImage.jpg?fm=jpg&q=75&w=1280&h=720&fit=crop', verify: true });
  const blur = new URL(v[1].u);
  assert.equal(v[1].r, 1.78);
  assert.equal(blur.pathname, '/series/6733/tile_177.jpg');
  assert.equal(blur.searchParams.get('w'), '1280');
  assert.equal(blur.searchParams.get('h'), '720');
  assert.equal(blur.searchParams.get('fit'), 'fill');
  assert.equal(urlRatio(v[1].u), 1.78);
  assert.deepEqual(variants('http://static-cdn.tv.sfr.net/data/img/pl/1.jpg'), []);
});

test('dimensions lues dans l\'en-tête : JPEG, PNG, WebP, GIF', () => {
  assert.deepEqual(imageSize(jpeg(600, 800)), { w: 600, h: 800 });
  assert.deepEqual(imageSize(jpeg(1920, 1080, 5000)), { w: 1920, h: 1080 });
  assert.deepEqual(imageSize(png(1680, 3636)), { w: 1680, h: 3636 });
  assert.deepEqual(imageSize(webpX(650, 366)), { w: 650, h: 366 });
  assert.deepEqual(imageSize(Buffer.from('GIF89a\x40\x01\xb4\x00xxxx', 'latin1')), { w: 320, h: 180 });
  assert.equal(imageSize(Buffer.from('<html>pas une image</html>')), undefined);
  // JPEG coupé avant le SOF
  assert.equal(imageSize(jpeg(1920, 1080, 5000).subarray(0, 3000)), undefined);
});

test('choix : horizontale d\'abord, sinon la plus large ; format inconnu = carré ; variante non vérifiée écartée', () => {
  const cache = new RatioCache(NOW);
  const sfrV = 'http://static-cdn.tv.sfr.net/v.jpg';
  const sfrH = 'http://static-cdn.tv.sfr.net/h.jpg';
  cache.set(sfrV, 0.75);
  cache.set(sfrH, 1.78);
  assert.deepEqual(pickImage(candidates([sfrV, sfrH]), cache), { i: sfrH, ir: 1.78 });
  // Télérama 3:2 réécrit en 16:9 passe avant une affiche verticale
  assert.deepEqual(pickImage(candidates([sfrV, 'https://focus.telerama.fr/252x168/80/a.jpg']), cache), { i: 'https://focus.telerama.fr/1280x720/80/a.jpg', ir: 1.78 });
  // rien d'horizontal : la plus large
  cache.set('http://x/a.jpg', 0.67);
  cache.set('http://x/b.jpg', 1.33);
  assert.deepEqual(pickImage(candidates(['http://x/a.jpg', 'http://x/b.jpg']), cache), { i: 'http://x/b.jpg', ir: 1.33 });
  // inconnue (compte comme carrée) contre verticale connue : l'inconnue
  assert.deepEqual(pickImage(candidates([sfrV, 'http://x/inconnue.jpg']), cache), { i: 'http://x/inconnue.jpg' });
  // image absente (404) écartée, sauf s'il n'y a qu'elle
  cache.set('http://x/404.jpg', 0);
  assert.deepEqual(pickImage(candidates(['http://x/404.jpg', sfrV]), cache), { i: sfrV, ir: 0.75 });
  assert.deepEqual(pickImage(candidates(['http://x/404.jpg']), cache), { i: 'http://x/404.jpg' });
  // Pluto : featuredImage vérifiée → retenue ; absente → fond flou 16:9
  const pluto = 'https://images.pluto.tv/series/6733/tile.jpg?fill=blur&fit=fill&fm=jpg&h=900&q=75&w=900';
  const [feat, blur] = variants(pluto);
  assert.deepEqual(pickImage(candidates([pluto]), cache), { i: blur.u, ir: 1.78 });
  cache.set(feat.u, 1.78);
  assert.deepEqual(pickImage(candidates([pluto]), cache), { i: feat.u, ir: 1.78 });
  cache.set(feat.u, 0);
  assert.deepEqual(pickImage(candidates([pluto]), cache), { i: blur.u, ir: 1.78 });
  // format écrit dans le XMLTV (width/height)
  assert.deepEqual(pickImage(candidates(['http://x/tv5.jpg'], new Map([['http://x/tv5.jpg', 1.77]])), cache), { i: 'http://x/tv5.jpg', ir: 1.77 });
  assert.ok(WIDE > 1.5 && WIDE < 1.78);
});

test('à sonder : seulement les inconnues avant la première horizontale connue', () => {
  const cache = new RatioCache(NOW);
  cache.set('http://x/v.jpg', 0.75);
  assert.deepEqual(toProbe(candidates(['http://x/v.jpg', 'http://x/a.jpg', 'https://thumb.canalplus.pro/http/unsafe/640x360/x', 'http://x/b.jpg']), cache), ['http://x/a.jpg']);
  const pluto = 'https://images.pluto.tv/series/6733/tile.jpg?fit=fill&h=900&w=900';
  assert.deepEqual(toProbe(candidates([pluto]), cache), [variants(pluto)[0].u]);
});

test('sondage : requête Range, 404 = absente, panne = on réessaiera', async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push(init.headers.range);
    if (url.endsWith('404')) return new Response('', { status: 404 });
    if (url.endsWith('panne')) throw new Error('ECONNRESET');
    if (url.endsWith('html')) return new Response('<html></html>', { status: 200 });
    if (url.endsWith('long')) {
      // en-tête JPEG de plus de 32 Ko : seconde requête plus longue
      const full = jpeg(1920, 1080, 40000);
      const m = /bytes=0-(\d+)/.exec(init.headers.range);
      return new Response(full.subarray(0, Math.min(full.length, +m[1] + 1)), { status: 206 });
    }
    return new Response(jpeg(600, 800), { status: 206 });
  };
  assert.equal(await probeRatio('http://x/ok', { fetchImpl: fake }), 0.75);
  assert.equal(seen[0], 'bytes=0-32767');
  assert.equal(await probeRatio('http://x/404', { fetchImpl: fake }), 0);
  assert.equal(await probeRatio('http://x/panne', { fetchImpl: fake }), undefined);
  assert.equal(await probeRatio('http://x/html', { fetchImpl: fake }), 0);
  assert.equal(await probeRatio('http://x/long', { fetchImpl: fake }), 1.78);

  const cache = new RatioCache(NOW);
  const res = await probeAll(['http://x/ok', 'http://x/404', 'http://x/panne'], cache, { fetchImpl: fake, concurrency: 2 });
  assert.deepEqual({ ...res }, { asked: 3, probed: 3, failed: 1, timedOut: 1, skipped: 0 });
  assert.equal(cache.get('http://x/ok'), 0.75);
  assert.equal(cache.get('http://x/404'), 0);
  assert.equal(cache.get('http://x/panne'), undefined);
  // délai total dépassé : rien n'est sondé, tout le reste attendra la génération suivante
  const late = await probeAll(['http://x/a', 'http://x/b'], new RatioCache(NOW), { fetchImpl: fake, budgetMs: 0 });
  assert.equal(late.skipped, 2);
});

test('cache : relu d\'une génération à l\'autre, échecs réessayés après 2 jours, oubli après 21 jours', () => {
  const dir = mkdtempSync(join(tmpdir(), 'epg-img-'));
  const a = new RatioCache(NOW);
  a.set('http://x/h.jpg', 1.78);
  a.set('http://x/404.jpg', 0);
  writeFileSync(join(dir, 'c.json.gz'), a.toGzip());
  const b = new RatioCache(NOW + 24 * 3600_000).load(join(dir, 'c.json.gz'));
  assert.equal(b.loaded, 2);
  assert.equal(b.get('http://x/h.jpg'), 1.78);
  assert.equal(b.get('http://x/404.jpg'), 0);
  const c = new RatioCache(NOW + 3 * 24 * 3600_000).load(join(dir, 'c.json.gz'));
  assert.equal(c.get('http://x/404.jpg'), undefined);
  const d = new RatioCache(NOW + 30 * 24 * 3600_000).load(join(dir, 'c.json.gz'));
  writeFileSync(join(dir, 'd.json.gz'), d.toGzip());
  assert.equal(new RatioCache(NOW).load(join(dir, 'd.json.gz')).loaded, 0);
  // fichier absent ou illisible : cache vide, pas d'erreur
  assert.equal(new RatioCache(NOW).load(join(dir, 'absent.gz')).loaded, 0);
  writeFileSync(join(dir, 'bad.gz'), 'nimporte quoi');
  assert.equal(new RatioCache(NOW).load(join(dir, 'bad.gz')).loaded, 0);
});

test('XMLTV : toutes les images d\'un programme, et leur format quand il est écrit', () => {
  const x = parseXmltv(`<tv><programme start="20261110200000 +0100" stop="20261110210000 +0100" channel="A.fr"><title>Pour tout dire</title>
    <icon src="http://s/v.jpg" /><icon src="http://s/h.jpg" width="1920" height="1080"/><icon src="http://s/v.jpg"/></programme>
    <programme start="20261110210000 +0100" stop="20261110220000 +0100" channel="A.fr"><title>Seul</title><icon src="http://s/1.jpg"/></programme></tv>`);
  assert.equal(x.programmes[0].i, 'http://s/v.jpg');
  assert.deepEqual(x.programmes[0].imgs, ['http://s/v.jpg', 'http://s/h.jpg']);
  assert.equal(x.programmes[1].i, 'http://s/1.jpg');
  assert.equal(x.programmes[1].imgs, undefined);
  assert.equal(x.iconRatios.get('http://s/h.jpg'), 1.78);
});

test('fusion : les images des autres sources pour le même programme sont gardées comme candidates', () => {
  const H = 3600_000;
  const a = [{ s: NOW, e: NOW + H, t: 'LCI Live', i: 'http://sfr/v.jpg' }, { s: NOW + H, e: NOW + 2 * H, t: 'Brunet' }];
  const b = [{ s: NOW, e: NOW + H, t: 'LCI Live', i: 'https://focus.telerama.fr/252x168/80/a.jpg', imgs: ['https://focus.telerama.fr/252x168/80/a.jpg', 'http://sfr/v.jpg'] }];
  const { progs } = mergeChannel([{ src: 'a', progs: a }, { src: 'b', progs: b }], NOW);
  assert.equal(progs[0].i, 'http://sfr/v.jpg'); // ancienne règle inchangée
  assert.deepEqual(progs[0].imgs, ['http://sfr/v.jpg', 'https://focus.telerama.fr/252x168/80/a.jpg']);
  assert.equal(progs[1].imgs, undefined);
  assert.deepEqual(pickImage(candidates(progs[0].imgs), new RatioCache(NOW)), { i: 'https://focus.telerama.fr/1280x720/80/a.jpg', ir: 1.78 });
});
