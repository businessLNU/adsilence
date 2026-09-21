#!/usr/bin/env node
/**
 * Die Marken-Bilder fuer die Store-Eintraege — Logo und Name in den drei
 * Formaten, die der Chrome Web Store kennt.
 *
 *     node extension/scripts/store-titelbild.mjs
 *
 * Ausgabe in `store/bilder/`:
 *   0-titelbild.jpg          1280x800  — als erstes Bildschirmfoto
 *   werbekachel-klein.jpg     440x280  — „Kleine Werbekachel", freiwillig
 *   werbekachel-gross.jpg    1400x560  — „Grosse Werbekachel", freiwillig
 *
 * ── Wofuer es da ist ──────────────────────────────────────────────────────
 * Der Chrome Web Store verlangt Bildschirmfotos in 1280x800, und zwar sowohl
 * unter „Lokalisierte" als auch unter „Globale Assets". Die fuenf echten
 * Motive (`store-bilder.mjs`) zeigen die Erweiterung im Betrieb; dieses Bild
 * zeigt nur die Marke und steht deshalb an erster Stelle — es ist das, was in
 * der Galerie als erstes gesehen wird.
 *
 * ── Warum es KEIN vergroessertes Symbol ist ───────────────────────────────
 * `icon-128.png` auf 1280 hochgezogen ist unscharf. Gezeichnet wird deshalb
 * die SVG-Quelle (`demo/public/adsilence-icon.svg`) in der Zielgroesse — ein
 * Vektor kennt keine Aufloesung.
 *
 * ── Warum JPEG und nicht PNG ──────────────────────────────────────────────
 * Der Store nimmt „JPEG oder 24-Bit-PNG (kein Alpha)". Playwrights PNG traegt
 * immer einen Alphakanal, auch bei deckendem Hintergrund — ein Bild mit Alpha
 * wird beim Hochladen abgewiesen. JPEG hat keinen. Der Verlauf hier hat keine
 * feinen Kanten, an denen die Kompression sichtbar wuerde.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ZIEL = join(WURZEL, 'store/bilder');

/** Die Markenfarben stehen in der `.env`, nicht hier (Regel 0). */
function ausEnv(name, rueckfall) {
  const zeile = readFileSync(join(WURZEL, '.env'), 'utf8')
    .split('\n')
    .find((z) => z.startsWith(`${name}=`));
  if (!zeile) return rueckfall;
  return zeile.slice(name.length + 1).replace(/^"|"$/g, '').trim() || rueckfall;
}

/**
 * Der Satz unter dem Namen, je Sprache.
 *
 * Vorgabe Englisch: Die Store-Eintraege stehen auf Englisch als
 * Bearbeitungssprache, und ein deutscher Slogan auf dem ersten Bild eines
 * englischen Eintrags ist der auffaelligste Bruch, den es dort gibt.
 *
 *     node extension/scripts/store-titelbild.mjs --sprache=de --aus=<ordner>
 */
const SLOGAN = {
  en: 'Blocks everything. Sees nothing.',
  de: 'Blockt alles. Und sieht nichts.',
};
const argument = (name, standard = null) => {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : standard;
};
const SPRACHE = argument('sprache', 'en');

const VON = ausEnv('BRAND_GRADIENT_FROM', '#e65909');
const BIS = ausEnv('BRAND_GRADIENT_TO', '#f6821f');
const NAME = ausEnv('BRAND_NAME', 'AdSilence');

const logo = readFileSync(join(WURZEL, 'demo/public/adsilence-icon.svg'), 'utf8');

/**
 * Die drei Formate, die der Store an Marken-Bildern kennt.
 *
 * Ein Bild je Format und nicht eines skaliert: Bei 440x280 ist neben dem Logo
 * kein Platz fuer einen Satz, bei 1400x560 stuende das Logo sonst verloren in
 * der Mitte. Die Groessen der Schrift stehen deshalb an der Kachel.
 */
const FORMATE = [
  { datei: '0-titelbild.jpg', breite: 1280, hoehe: 800, logo: 260, titel: 92, satz: 30, mitSatz: true },
  { datei: 'werbekachel-klein.jpg', breite: 440, hoehe: 280, logo: 96, titel: 40, satz: 0, mitSatz: false },
  { datei: 'werbekachel-gross.jpg', breite: 1400, hoehe: 560, logo: 190, titel: 78, satz: 26, mitSatz: true },
];

function seiteFuer(f) {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    inline-size: ${f.breite}px; block-size: ${f.hoehe}px;
    display: grid; place-items: center;
    background: radial-gradient(120% 100% at 50% 0%, ${BIS} 0%, ${VON} 68%, #b8430a 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #fff;
  }
  .stapel { display: grid; justify-items: center; gap: ${Math.round(f.logo * 0.13)}px; }
  .logo { inline-size: ${f.logo}px; block-size: ${f.logo}px; display: grid; place-items: center; }
  .logo svg { inline-size: 100%; block-size: 100%; }
  h1 { margin: 0; font-size: ${f.titel}px; font-weight: 800; letter-spacing: -0.045em; line-height: 1; }
  p  { margin: 0; font-size: ${f.satz}px; font-weight: 500; opacity: 0.92; letter-spacing: -0.01em; }
</style>
<div class="stapel">
  <div class="logo">${logo}</div>
  <h1>${NAME}</h1>
  ${f.mitSatz ? `<p>${SLOGAN[SPRACHE] ?? SLOGAN.en}</p>` : ''}
</div>`;
}

const browser = await chromium.launch();
mkdirSync(ZIEL, { recursive: true });

for (const f of FORMATE) {
  const blatt = await browser.newPage({
    viewport: { width: f.breite, height: f.hoehe },
    deviceScaleFactor: 1,
  });
  await blatt.setContent(seiteFuer(f), { waitUntil: 'load' });
  await blatt.evaluate(() => document.fonts.ready);

  const datei = join(ZIEL, f.datei);
  const bild = await blatt.screenshot({ type: 'jpeg', quality: 95 });
  writeFileSync(datei, bild);
  await blatt.close();
  console.log(`${f.breite}x${f.hoehe} -> ${datei} (${(bild.length / 1024).toFixed(0)} kB)`);
}

await browser.close();
