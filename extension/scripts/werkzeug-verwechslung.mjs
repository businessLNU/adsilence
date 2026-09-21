#!/usr/bin/env node
/**
 * Baut `werkzeuge/verwechslung.html` im Wurzelverzeichnis: eine Seite, auf der
 * sich die Verwechslungserkennung ausprobieren laesst, ohne eine Erweiterung
 * zu installieren und ohne eine gefaelschte Seite wirklich aufzurufen.
 *
 *     node scripts/werkzeug-verwechslung.mjs
 *
 * Warum erzeugt und nicht von Hand geschrieben: Die Seite fuehrt DIESELBE
 * Funktion aus, die in der Erweiterung entscheidet (`gemeinsam/phishing.ts`),
 * und dieselbe Markenliste. Eine nachgebaute Kopie liefe frueher oder spaeter
 * auseinander, und dann zeigte das Werkzeug etwas anderes als das Produkt.
 *
 * Erreichbar wird sie ueber den Server des Backends, der `werkzeuge/`
 * ausliefert: http://localhost:3000/werkzeuge/verwechslung.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = join(WURZEL, '..', 'werkzeuge', 'verwechslung.html');

const gebaut = await build({
  entryPoints: [join(WURZEL, 'src', 'gemeinsam', 'phishing.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Phishing',
  target: ['chrome121', 'firefox128', 'safari17'],
  write: false,
  minify: false,
  legalComments: 'none',
});
const code = gebaut.outputFiles[0].text;
const marken = readFileSync(join(WURZEL, 'phishing', 'marken.json'), 'utf8');

const BEISPIELE = [
  ['xn--mazon-3ve.de', 'kyrillisches a in amazon.de'],
  ['paypaI.com', 'grosses I statt kleinem l'],
  ['paypal-login.xyz', 'Marke im fremden Namen'],
  ['rnicrosoft.com', 'rn sieht aus wie m'],
  ['payypal.com', 'ein Zeichen zu viel'],
  ['amazon.de', 'die echte Adresse'],
  ['tagesschau.de', 'voellig fremd'],
  ['xn--mnchen-3ya.de', 'muenchen.de, eine echte internationale Adresse'],
];

const seite = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verwechslungswarner ausprobieren</title>
<style>
  :root { --grund:#f6f7f9; --flaeche:#fcfcfd; --text:#14181f; --schwach:#5b6472; --von:#2a63d4; --gut:#15803d; --fehler:#b91c1c; --linie:rgba(0,0,0,.1); }
  @media (prefers-color-scheme: dark) { :root { --grund:#0e1116; --flaeche:#151a22; --text:#eef1f5; --schwach:#9aa3b2; --linie:rgba(255,255,255,.12); --gut:#4ade80; --fehler:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 20px 80px; background:var(--grund); color:var(--text); font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .blatt { max-width: 680px; margin: 0 auto; }
  h1 { font-size:30px; letter-spacing:-.02em; margin:0 0 8px; }
  p.unter { color:var(--schwach); margin:0 0 28px; }
  .feld { display:flex; gap:8px; margin-bottom:8px; }
  input { flex:1; padding:14px 16px; font:16px ui-monospace,SFMono-Regular,Menlo,monospace; border:1px solid var(--linie); border-radius:10px; background:var(--flaeche); color:var(--text); }
  input:focus { outline:2px solid var(--von); outline-offset:1px; }
  .ergebnis { margin:20px 0 32px; padding:20px; border-radius:12px; background:var(--flaeche); border:1px solid var(--linie); }
  .ergebnis.leer { color:var(--schwach); }
  .kopf { font-size:18px; font-weight:700; margin-bottom:12px; }
  .kopf.warnt { color:var(--fehler); }
  .kopf.still { color:var(--gut); }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:0; font-size:14px; }
  dt { color:var(--schwach); }
  dd { margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--schwach); margin:32px 0 10px; }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
  li button { width:100%; text-align:left; display:flex; justify-content:space-between; gap:16px; align-items:baseline;
    padding:12px 14px; border:1px solid var(--linie); border-radius:10px; background:var(--flaeche); color:var(--text); cursor:pointer; font:inherit; }
  li button:hover { border-color:var(--von); }
  li code { font-size:14px; }
  li span { color:var(--schwach); font-size:13px; text-align:right; }
  footer { margin-top:40px; color:var(--schwach); font-size:13px; border-top:1px solid var(--linie); padding-top:16px; }
</style>
</head>
<body>
<div class="blatt">
  <h1>Verwechslungswarner</h1>
  <p class="unter">Tippe eine Adresse ein. Die Seite fuehrt dieselbe Pruefung aus wie die Erweiterung und sagt, ob sie warnen wuerde und warum. Es wird nichts aufgerufen und nichts verschickt.</p>

  <div class="feld">
    <input id="eingabe" placeholder="zum Beispiel xn--mazon-3ve.de" autocomplete="off" spellcheck="false" autofocus>
  </div>
  <div class="ergebnis leer" id="ergebnis">Noch nichts eingegeben.</div>

  <h2>Zum Ausprobieren</h2>
  <ul id="beispiele"></ul>

  <footer>
    Diese Seite wird erzeugt aus <code>extension/src/gemeinsam/phishing.ts</code> und
    <code>extension/phishing/marken.json</code>. Wer die Erkennung aendert, faehrt
    <code>npm run werkzeug:verwechslung</code> und bekommt die Seite auf dem neuen Stand.
  </footer>
</div>

<script>${code}</script>
<script>
  const MARKEN = ${marken};
  const BEISPIELE = ${JSON.stringify(BEISPIELE)};
  const eingabe = document.getElementById('eingabe');
  const ergebnis = document.getElementById('ergebnis');

  function zeige(host) {
    const wert = host.trim();
    if (!wert) { ergebnis.className = 'ergebnis leer'; ergebnis.textContent = 'Noch nichts eingegeben.'; return; }
    const v = Phishing.pruefeHost(wert, MARKEN);
    const lesbar = Phishing.entschluesseleHost(wert);
    ergebnis.className = 'ergebnis';
    const kopf = document.createElement('div');
    kopf.className = 'kopf ' + (v ? 'warnt' : 'still');
    kopf.textContent = v ? 'Es wuerde gewarnt' : 'Keine Warnung';
    const dl = document.createElement('dl');
    const zeile = (was, wert) => {
      const dt = document.createElement('dt'); dt.textContent = was;
      const dd = document.createElement('dd'); dd.textContent = wert;
      dl.append(dt, dd);
    };
    zeile('Eingegeben', wert);
    if (lesbar !== wert) zeile('Lesbar', lesbar);
    if (v) {
      zeile('Nachgeahmt', v.marke);
      zeile('Echte Adresse', v.echt);
      zeile('Erkannt als', {
        homoglyph: 'verwechselbare Zeichen',
        punycode: 'fremde Schrift, die lateinisch aussieht',
        markeAlsTeil: 'Markenname in einer fremden Adresse',
        einZeichen: 'ein Zeichen daneben',
      }[v.grund] ?? v.grund);
    } else {
      zeile('Form', Phishing.skelett(lesbar));
      zeile('Registrierbar', Phishing.registrierbar(lesbar));
    }
    ergebnis.replaceChildren(kopf, dl);
  }

  eingabe.addEventListener('input', () => zeige(eingabe.value));

  const liste = document.getElementById('beispiele');
  for (const [host, was] of BEISPIELE) {
    const li = document.createElement('li');
    const knopf = document.createElement('button');
    knopf.type = 'button';
    const code = document.createElement('code'); code.textContent = host;
    const span = document.createElement('span'); span.textContent = was;
    knopf.append(code, span);
    knopf.addEventListener('click', () => { eingabe.value = host; zeige(host); eingabe.focus(); });
    li.append(knopf);
    liste.append(li);
  }
</script>
</body>
</html>
`;
mkdirSync(dirname(ZIEL), { recursive: true });
writeFileSync(ZIEL, seite);
process.stdout.write(`werkzeuge/verwechslung.html geschrieben (${(seite.length / 1024).toFixed(0)} kB)\n`);
