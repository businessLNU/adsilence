#!/usr/bin/env node
/**
 * „Deaktiviere deinen Werbeblocker" — kommt die Wand noch?
 *
 *     node tests/laufzeit/wand-probe.mjs [adresse ...]
 *
 * DIFFERENZMESSUNG statt Selektorraten. Dieselbe Seite wird zweimal geladen:
 * einmal MIT der gebauten Erweiterung, einmal OHNE. Verglichen wird, was nur
 * im ersten Lauf da ist. Ein fester Selektor („.adblock-overlay") waere je
 * Seite ein anderer und morgen ein dritter; der Unterschied zwischen beiden
 * Laeufen ist dagegen genau das, was die Erweiterung ausgeloest hat.
 *
 * Gemessen wird je Lauf:
 *   • sichtbarer Text von Elementen, die ueber dem Inhalt liegen
 *     (position fixed/absolute mit hohem z-index) — dort sitzt jede Wand
 *   • ob der Bildlauf gesperrt ist (`overflow: hidden` am Body) — das
 *     Erkennungsmerkmal, das bleibt, auch wenn der Text im Bild steht
 *   • Woerter, die auf eine Wand deuten, im GESAMTEN sichtbaren Text
 *
 * Danach wird ein Abspielknopf gesucht und gedrueckt, weil die Wand oft erst
 * dann kommt (so hat der Nutzer sie gesehen), und alles noch einmal gemessen.
 *
 * Ein Bildschirmfoto je Lauf landet in `.probe-wand/`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const PAKET = join(HIER, '..', '..', 'dist', 'chromium');
const AUS = join(HIER, '..', '..', '.probe-wand');
mkdirSync(AUS, { recursive: true });

const ADRESSEN = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://aniworld.to/anime/stream/black-torch/staffel-1/episode-1'];

/** Woerter, mit denen Seiten ihre Wand beschriften. */
const WANDWOERTER =
  /(ad\s?block|adblocker|werbeblocker|anzeigenblocker|deaktivier\w*\s+(dein|ihren?)|disable\s+(your\s+)?ad|turn\s+off\s+(your\s+)?ad|whitelist|pop-?up\s?blocker)/i;

const startOptionen = (mitErweiterung) => ({
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    ...(mitErweiterung
      ? [`--disable-extensions-except=${PAKET}`, `--load-extension=${PAKET}`]
      : []),
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
  ],
  viewport: { width: 1280, height: 900 },
  locale: 'de-DE',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
});

/** Was auf der Seite gerade zu sehen ist, verdichtet. */
const MESSEN = () => {
  const sichtbar = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 20;
  };
  const oben = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    const z = parseInt(s.zIndex, 10);
    if (!Number.isFinite(z) || z < 100) continue;
    if (!sichtbar(el)) continue;
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (text) oben.push({ z, text });
  }
  oben.sort((a, b) => b.z - a.z);
  const koerper = getComputedStyle(document.body);
  return {
    titel: document.title,
    gesperrt: koerper.overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden',
    obenauf: oben.slice(0, 12),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 6000),
  };
};

/**
 * Messen im HAUPTDOKUMENT UND in jedem eingebetteten Rahmen.
 *
 * Ohne die Rahmen misst man bei einer Streamingseite die falsche Stelle: Die
 * Seite selbst ist harmlos, der Player kommt von einem Hoster (VOE,
 * Doodstream, Filemoon, Vidmoly) und steckt in einem iframe. Genau dort sitzt
 * die Erkennung.
 */
async function messeAlles(seite) {
  const staende = [];
  for (const rahmen of seite.frames()) {
    try {
      const stand = await rahmen.evaluate(MESSEN);
      staende.push({ herkunft: new URL(rahmen.url()).host || '(leer)', ...stand });
    } catch {
      // Ein Rahmen, der gerade navigiert, laesst sich nicht befragen.
    }
  }
  return staende;
}

/**
 * Einen Hoster waehlen — das ist auf dieser Seite „Play".
 *
 * Der Abspielknopf steht nicht im Dokument: Man klickt `<a href="/redirect/…">`
 * mit dem Hosternamen darin, und erst dann laedt der eingebettete Player.
 * Bevorzugt wird der zuerst angebotene; die Reihenfolge ist die der Seite.
 */
async function waehleHoster(seite) {
  const link = seite.locator('a[href^="/redirect/"]').first();
  try {
    if ((await link.count()) === 0) return null;
    const name = (await link.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 40);
    await link.scrollIntoViewIfNeeded({ timeout: 5000 });
    await link.click({ timeout: 8000 });
    return name || 'Hoster';
  } catch (e) {
    return `nicht klickbar: ${String(e).split('\n')[0].slice(0, 80)}`;
  }
}

/**
 * „Play" ist hier der Knopf IM eingebetteten Player, nicht im Dokument. Der
 * Player sitzt im groessten sichtbaren iframe; sein Abspielknopf liegt in
 * dessen Mitte. Geklickt wird deshalb die Mitte des groessten Rahmens.
 */
async function drueckePlayImRahmen(seite) {
  const ziel = await seite.evaluate(() => {
    let best = null;
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      if (!best || r.width * r.height > best.flaeche) {
        best = { x: r.x + r.width / 2, y: r.y + r.height / 2, flaeche: r.width * r.height, src: f.src };
      }
    }
    if (best) window.scrollTo(0, Math.max(0, window.scrollY + best.y - window.innerHeight / 2));
    return best;
  });
  if (!ziel) return null;
  // Nach dem Bildlauf liegt der Rahmen woanders: Position neu holen.
  const neu = await seite.evaluate(() => {
    let best = null;
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      if (!best || r.width * r.height > best.flaeche) best = { x: r.x + r.width / 2, y: r.y + r.height / 2, flaeche: r.width * r.height };
    }
    return best;
  });
  if (!neu) return null;
  await seite.mouse.click(neu.x, neu.y);
  let host = '(leer)';
  try { host = new URL(ziel.src).host; } catch { /* srcdoc oder leer */ }
  return host;
}

/** Der Weg eines Tabs: jede Anfrage im Hauptrahmen, Umleitungsglieder einzeln. */
const wege = new Map();
function verfolge(p) {
  const weg = [p.url()];
  wege.set(p, weg);
  p.on('request', (req) => {
    try {
      if (req.isNavigationRequest() && req.frame() === p.mainFrame()) weg.push(req.url());
    } catch {
      // Rahmen schon weg.
    }
  });
}

/** Ein neuer Tab: wohin er ging und ob er ueberlebt hat. */
async function beobachteTab(p, wieLange) {
  const start = Date.now();
  let letzteUrl = p.url();
  while (Date.now() - start < wieLange) {
    if (p.isClosed()) return { url: letzteUrl, zu: true, staende: null };
    letzteUrl = p.url();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (p.isClosed()) return { url: letzteUrl, zu: true, staende: null, weg: wege.get(p) ?? [] };
  let staende = null;
  try { staende = await messeAlles(p); } catch { /* Tab gerade weg */ }
  return { url: p.url(), zu: false, staende, weg: wege.get(p) ?? [] };
}

async function lauf(adresse, mitErweiterung, marke) {
  const browser = await chromium.launchPersistentContext(
    join(AUS, `profil-${marke}`),
    startOptionen(mitErweiterung),
  );
  const ergebnis = {
    fehler: null,
    vorher: null,
    nachPlay: null,
    playIn: null,
    hoster: null,
    tabs: [],
  };
  const neueSeiten = [];
  try {
    // Der Worker der Erweiterung braucht einen Moment, sonst misst man ihn
    // beim Anlaufen statt die Seite.
    if (mitErweiterung) await new Promise((r) => setTimeout(r, 3000));
    browser.on('page', (p) => { neueSeiten.push(p); verfolge(p); });

    const seite = await browser.newPage();
    // Die eigene Seite ist kein „neuer Tab".
    neueSeiten.length = 0;
    await seite.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await seite.waitForTimeout(5000);
    ergebnis.vorher = await messeAlles(seite);
    await seite.screenshot({ path: join(AUS, `${marke}-1-geladen.png`) });

    // 1) Play im eingebetteten Player -- so hat der Nutzer die Wand gesehen.
    ergebnis.playIn = await drueckePlayImRahmen(seite);
    await seite.waitForTimeout(12000);
    ergebnis.nachPlay = await messeAlles(seite);
    await seite.screenshot({ path: join(AUS, `${marke}-2-nach-play.png`) });

    // 2) Der Hoster-Link, der im NEUEN Tab aufgeht.
    ergebnis.hoster = await waehleHoster(seite);
    await seite.waitForTimeout(12000);

    // Jeder Tab, den die Seite selbst aufgemacht hat: wohin, und lebt er noch?
    for (const p of neueSeiten) ergebnis.tabs.push(await beobachteTab(p, 1500));
    for (const [i, p] of neueSeiten.entries()) {
      if (!p.isClosed()) {
        await p.screenshot({ path: join(AUS, `${marke}-3-tab${i + 1}.png`) }).catch(() => {});
      }
    }
  } catch (e) {
    ergebnis.fehler = String(e).split('\n')[0].slice(0, 200);
  } finally {
    await browser.close().catch(() => {});
  }
  return ergebnis;
}

function wandWoerter(staende) {
  if (!staende) return [];
  const funde = new Set();
  for (const stand of staende) {
    const wo = stand.herkunft ? `${stand.herkunft} ` : '';
    for (const { text } of stand.obenauf) {
      if (WANDWOERTER.test(text)) funde.add(`${wo}obenauf: ${text.slice(0, 160)}`);
    }
    const satz = (stand.text.match(new RegExp(`[^.!?]{0,120}${WANDWOERTER.source}[^.!?]{0,120}`, 'i')) || [])[0];
    if (satz) funde.add(`${wo}im Text: ${satz.trim().slice(0, 200)}`);
  }
  return [...funde];
}

/** Ist irgendwo der Bildlauf gesperrt? */
const irgendwoGesperrt = (staende) => Boolean(staende && staende.some((s) => s.gesperrt));

/** Wie viele Schichten liegen ueber allem, ueber alle Rahmen? */
const schichten = (staende) => (staende ? staende.reduce((n, s) => n + s.obenauf.length, 0) : 0);

const bericht = [];
for (const adresse of ADRESSEN) {
  const marke = adresse.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  process.stdout.write(`\n${'═'.repeat(74)}\n${adresse}\n${'═'.repeat(74)}\n`);

  const mit = await lauf(adresse, true, `${marke}-mit`);
  const ohne = await lauf(adresse, false, `${marke}-ohne`);

  const zeile = (wann, stand) => {
    const funde = wandWoerter(stand);
    process.stdout.write(
      `  ${wann.padEnd(14)} Rahmen ${String(stand?.length ?? 0).padStart(2)}  ` +
        `Bildlauf ${irgendwoGesperrt(stand) ? 'GESPERRT' : 'frei    '}  ` +
        `Schichten: ${String(schichten(stand)).padStart(2)}  ` +
        `Wandwoerter: ${funde.length}\n`,
    );
    for (const f of funde) process.stdout.write(`                  ↳ ${f}\n`);
  };
  for (const [name, r] of [['MIT Erweiterung', mit], ['OHNE Erweiterung', ohne]]) {
    process.stdout.write(`\n${name}\n`);
    if (r.fehler) {
      process.stdout.write(`  Seite nicht messbar: ${r.fehler}\n`);
      continue;
    }
    zeile('geladen', r.vorher);
    process.stdout.write(`  Play gedrueckt in: ${r.playIn ?? 'kein Player-Rahmen gefunden'}\n`);
    zeile('nach Play', r.nachPlay);
    process.stdout.write(`  Hoster geklickt:   ${r.hoster ?? 'keiner gefunden'}\n`);
    process.stdout.write(`  Neue Tabs: ${r.tabs.length}\n`);
    for (const [i, t] of r.tabs.entries()) {
      process.stdout.write(`    Tab ${i + 1}: ${t.zu ? 'GESCHLOSSEN' : 'offen'}  ${t.url.slice(0, 100)}\n`);
      if (t.weg && t.weg.length > 1) {
        process.stdout.write(`           Weg: ${t.weg.map((u) => { try { return new URL(u).host || u; } catch { return u; } }).join(' → ').slice(0, 300)}\n`);
      }
      if (t.staende) zeile(`    Tab ${i + 1}`, t.staende);
    }
  }

  // Das Urteil: was NUR mit Erweiterung da ist.
  const nurMit = [];
  if (!mit.fehler && !ohne.fehler) {
    const alle = (r) => [r.vorher, r.nachPlay, ...r.tabs.map((t) => t.staende)].filter(Boolean).flat();
    const ohneFunde = new Set(wandWoerter(alle(ohne)));
    for (const f of wandWoerter(alle(mit))) if (!ohneFunde.has(f)) nurMit.push(f);
  }
  process.stdout.write(`\n  URTEIL: ${nurMit.length === 0 ? 'keine Wand, die es ohne uns nicht auch gaebe' : 'WAND'}\n`);
  for (const f of nurMit) process.stdout.write(`    • ${f}\n`);
  bericht.push({ adresse, wand: nurMit.length > 0, nurMit, mit, ohne });
}

writeFileSync(join(AUS, 'bericht.json'), JSON.stringify(bericht, null, 2));
process.stdout.write(`\nBildschirmfotos und Bericht: ${AUS}\n`);
process.exit(bericht.some((b) => b.wand) ? 1 : 0);
