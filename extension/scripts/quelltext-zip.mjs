#!/usr/bin/env node
/**
 * Das Quelltextpaket fuer die AMO-Pruefung.
 *
 *     node extension/scripts/quelltext-zip.mjs
 *
 * Ausgabe: `extension/dist/adsilence-quelltext-<version>.zip`
 *
 * ── Warum es das braucht ──────────────────────────────────────────────────
 * AMO verlangt den Quelltext, sobald ein Paket gebuendelten Code enthaelt —
 * und unseres tut das (esbuild fuer Hintergrund und Inhaltsskripte, Vite fuer
 * die Oberflaechenseiten). Minimiert wird ausdruecklich NICHT (`minify: false`
 * an beiden Stellen in `build.mjs`); gebuendelt reicht aber schon.
 *
 * ── Was hineingehoert ─────────────────────────────────────────────────────
 * Genau das, was unter Versionskontrolle steht — nicht mehr und nicht
 * weniger. `git ls-files` ist die Liste, und sie ist es aus einem Grund: Was
 * im Repo liegt, ist das, woraus wir selbst bauen. Eine von Hand gepflegte
 * Auswahl waere eine zweite Wahrheit und liefe der ersten hinterher.
 *
 * Draussen bleiben damit automatisch `node_modules/`, `dist/` und jedes
 * Probenverzeichnis — sie stehen in `.gitignore`.
 *
 * ── Warum die rohen Filterlisten MITKOMMEN ────────────────────────────────
 * `listen/quellen/*.txt` sind 64 Dateien und der groesste Teil des Pakets.
 * Sie liessen sich mit `npm run listen:holen` nachladen, und die Anleitung
 * nennt den Befehl. Trotzdem liegen sie bei: Die Listen aendern sich
 * taeglich. Laedt der Pruefer sie in zwei Wochen neu, entstehen ANDERE
 * `rules/*.json` als die im eingereichten Paket — und dann steht er vor
 * einem Unterschied, den er nicht erklaeren kann. Reproduzierbar heisst,
 * dass dasselbe herauskommt.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJEKT = join(WURZEL, '..');
const version = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8')).version;

const ziel = join(WURZEL, 'dist', `adsilence-quelltext-${version}.zip`);
mkdirSync(dirname(ziel), { recursive: true });
rmSync(ziel, { force: true });

/**
 * Was die Erweiterung von AUSSERHALB ihres Ordners liest.
 *
 * ── GEMESSEN am 14.09.2026 ────────────────────────────────────────────────
 * Das erste Quelltextpaket enthielt nur `extension/`. Ausgepackt und gebaut,
 * so wie ein Pruefer es taete, brach der Bau ab:
 *
 *   [vite:load-fallback] Could not load ../frontend/i18n
 *   (imported by src/oberflaeche/i18n.ts)
 *
 * `vite.config.ts` legt den Alias `bausteine` auf `../frontend` — dieselben
 * Bausteine, die auch die Website benutzt, absichtlich geteilt statt kopiert.
 * Fuer uns ist der Ordner da; im Paket war er es nicht. Der Pruefer haette
 * genau diesen Fehler gesehen, und „laesst sich nicht reproduzieren" ist ein
 * Ablehnungsgrund.
 *
 * Die Pfade behalten ihre Ebene: Ausgepackt liegt `frontend/` neben
 * `extension/`, und `../frontend` trifft. Mitgegeben wird NUR, was wirklich
 * importiert wird — `tests/rechenregeln/92-…` faellt um, sobald die
 * Erweiterung einen zweiten Baustein zieht, der hier fehlt.
 */
const AUSSERHALB = ['frontend/i18n.ts'];

const dateien = [
  ...execFileSync('git', ['ls-files', 'extension/'], { cwd: PROJEKT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
  ...AUSSERHALB,
];

/*
 * Die Anleitung liegt als `README.md` in der WURZEL des Archivs.
 *
 * AMO verlangt sie ausdruecklich: „Schritt-fuer-Schritt-Anleitung zum
 * Erstellen einer exakten Kopie des Add-on-Quelltextes in einer README-Datei
 * in Ihrem Quelltext". `extension/README.md` gibt es zwar, aber die ist unsere
 * Entwicklerdokumentation — deutsch, dreissig Abschnitte, und die Bauanleitung
 * steht darin zwischen Proben und Messwerten. Wer sie liest, um ein Paket
 * nachzubauen, sucht zu lange.
 *
 * Deshalb eine zweite, die genau das beantwortet, was gefragt ist, auf
 * Englisch und in der Wurzel — dort sieht sie der Pruefer als erstes.
 */

if (dateien.length === 0) {
  process.stderr.write('[quelltext] git ls-files hat nichts geliefert — kein Repository?\n');
  process.exit(1);
}

/*
 * Die Liste geht ueber die Standardeingabe an `zip`, nicht als Argumente:
 * 467 Pfade sprengen auf manchen Systemen die Laenge der Befehlszeile, und
 * der Fehler dabei ist keiner, den man gleich als solchen erkennt.
 */
execFileSync('zip', ['-q', '-X', '-@', ziel], { cwd: PROJEKT, input: dateien.join('\n') });

/*
 * Sie liegt im Repo unter `extension/QUELLTEXT-README.md` — im Archiv aber als
 * `README.md` ganz oben, denn danach fragt AMO namentlich.
 *
 * Der Umweg ueber ein Wegwerf-Verzeichnis ist noetig, weil `zip` die Datei
 * unter ihrem eigenen Namen ablegt: `-j` nimmt den Pfad weg, nicht den Namen.
 * Umbenennen im Repo ginge nicht — dort gibt es `extension/README.md` schon,
 * und das ist eine andere Datei.
 */
const zwischen = mkdtempSync(join(tmpdir(), 'quelltext-'));
try {
  cpSync(join(WURZEL, 'QUELLTEXT-README.md'), join(zwischen, 'README.md'));
  execFileSync('zip', ['-q', '-X', '-j', ziel, join(zwischen, 'README.md')], { cwd: PROJEKT });
} finally {
  rmSync(zwischen, { recursive: true, force: true });
}

if (!existsSync(ziel)) {
  process.stderr.write('[quelltext] Das Zip ist nicht entstanden.\n');
  process.exit(1);
}
const groesse = readFileSync(ziel).length;
process.stdout.write(`[quelltext] ${ziel} (${dateien.length} Dateien, ${(groesse / 1024 / 1024).toFixed(2)} MB)\n`);
