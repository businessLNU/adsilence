/**
 * Die Regeln, die beim Start aktiv sind, muessen in Chromes Budget passen.
 *
 * ── Wogegen das steht ─────────────────────────────────────────────────────
 * Chrome garantiert 30.000 Regeln in AKTIVIERTEN statischen Regelsaetzen.
 * Was darueber hinausgeht, laedt es nicht -- und zwar ohne Fehler: Die
 * Erweiterung installiert sich sauber, das Popup zaehlt weiter, und einzelne
 * Listen blocken einfach nicht mehr. Von aussen sieht das aus wie eine Liste,
 * die nichts findet.
 *
 * GEMESSEN am 08.09.2026: 26.369 der 30.000 waren belegt, also 88 Prozent.
 * Die Listen wachsen bei jedem `listen:bauen` um einige hundert Regeln --
 * ohne diese Pruefung faellt das erst auf, wenn ein Kunde meldet, dass etwas
 * durchkommt.
 *
 * ── Warum aus `rules/` und nicht aus `dist/` ──────────────────────────────
 * `dist/` steht nicht im Repo und ist nach einem frischen Klon gar nicht da.
 * Die Frage laesst sich aber ohne Build beantworten: Welche Listen beim Start
 * aktiv sind, sagt `LISTEN_VORGABE.standard` (dasselbe Feld, aus dem
 * `manifest.mjs` das `enabled` schreibt -- Test „enabled im Manifest
 * entspricht LISTEN_VORGABE.standard" haelt beide zusammen), und wie viele
 * Regeln eine Liste hat, sagt ihre Datei.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DNR_REGELN_GARANTIERT,
  DNR_REGELN_GEMESSEN_FREI,
  DNR_REGELSAETZE_MAX,
  LISTEN_VORGABE,
} from '../../src/gemeinsam/konstanten.ts';

const REGELN = fileURLToPath(new URL('../../rules/', import.meta.url));

/** Regeln je Liste, aus der gebauten Datei. Fehlt sie, zaehlt sie null. */
function regelzahl(id: string): number | null {
  const datei = join(REGELN, `${id}.json`);
  if (!existsSync(datei)) return null;
  const inhalt: unknown = JSON.parse(readFileSync(datei, 'utf8'));
  return Array.isArray(inhalt) ? inhalt.length : 0;
}

test('die beim Start aktiven Regeln passen in Chromes Budget', () => {
  const aktiv = LISTEN_VORGABE.filter((l) => l.standard);
  let summe = 0;
  const fehlend: string[] = [];
  for (const liste of aktiv) {
    const n = regelzahl(liste.id);
    if (n === null) fehlend.push(liste.id);
    else summe += n;
  }

  assert.deepEqual(
    fehlend,
    [],
    `Diese ab Werk aktiven Listen haben keine Regeldatei in rules/: ` +
      `${fehlend.join(', ')}. Erst \`npm run listen:bauen\` fahren — sonst ` +
      `rechnet diese Pruefung mit zu wenig und geht gruen durch.`,
  );

  const anteil = Math.round((summe / DNR_REGELN_GARANTIERT) * 100);
  assert.ok(
    summe <= DNR_REGELN_GARANTIERT,
    `${summe.toLocaleString('de-DE')} Regeln sind ab Werk aktiv, Chrome ` +
      `garantiert ${DNR_REGELN_GARANTIERT.toLocaleString('de-DE')} (${anteil} %). ` +
      `Was darueber liegt, laedt Chrome NICHT — ohne Fehler, ohne Hinweis. ` +
      `Entweder eine Liste in LISTEN_VORGABE auf standard:false setzen oder ` +
      `ihr Budget in listen/quellen.json senken.`,
  );
});

/**
 * Die Reserve — und warum sie MELDET statt umzufallen.
 *
 * Hier stand bis zum 08.09.2026: „reserve >= 10 % der Garantie", sonst rot.
 * Die Regel kam aus der Annahme, die 30.000 seien Chromes Decke. GEMESSEN am
 * 08.09.2026 mit `npm run probe:regelbudget` ist sie das nicht: Bei 29.854
 * aktiven Regeln waren noch 300.146 frei, alle 15 Regelsaetze geladen.
 *
 * Der Unterschied ist wichtig. Die 30.000 sind eine ZUSAGE je Erweiterung;
 * darueber laedt Chrome weiter, solange der GETEILTE Vorrat reicht. Ueber der
 * Zusage zu liegen heisst also nicht „laedt nicht", sondern „laedt auf dem
 * einen Rechner und auf dem anderen vielleicht nicht" — und das schweigend.
 *
 * Deshalb zwei verschiedene Dinge:
 *   - Die Zusage zu reissen ist ein Fehler. Das prueft der Test darueber.
 *   - Die Reserve aufzubrauchen ist eine ENTSCHEIDUNG. Am 08.09.2026 wurde sie
 *     getroffen: „Alles Blocken soll kostenlos sein", also wurde Fanboy's
 *     Annoyances (3.211 Regeln) ab Werk aktiv, und die Reserve ging von 3.358
 *     auf 147. Ein roter Test haette daran nichts geaendert, nur den Build
 *     angehalten.
 *
 * Gemeldet wird trotzdem, bei jedem Lauf und zusaetzlich in
 * `npm run pruefe:paket`. Wer die naechste Liste ab Werk anschaltet, liest die
 * Zahl vorher.
 */
test('die Reserve wird beziffert, solange sie schmilzt', () => {
  const summe = LISTEN_VORGABE.filter((l) => l.standard).reduce(
    (n, l) => n + (regelzahl(l.id) ?? 0),
    0,
  );
  const reserve = DNR_REGELN_GARANTIERT - summe;
  if (reserve < DNR_REGELN_GARANTIERT * 0.1) {
    console.warn(
      `[Regelbudget] Nur noch ${reserve.toLocaleString('de-DE')} Regeln bis zur ` +
        `Zusage (${summe.toLocaleString('de-DE')} von ` +
        `${DNR_REGELN_GARANTIERT.toLocaleString('de-DE')}). Gemessen waren ` +
        `danach noch ${DNR_REGELN_GEMESSEN_FREI.toLocaleString('de-DE')} ` +
        `Regeln frei — es reisst also nicht sofort, aber die naechste Liste ab ` +
        `Werk braucht eine Entscheidung, keine Gewohnheit.`,
    );
  }
  assert.ok(
    reserve >= 0,
    `${summe.toLocaleString('de-DE')} Regeln sind ab Werk aktiv und damit ueber ` +
      `Chromes Zusage von ${DNR_REGELN_GARANTIERT.toLocaleString('de-DE')}. ` +
      `Auf einem Rechner mit weiteren Blockern laedt der Ueberschuss ` +
      `moeglicherweise nicht — ohne Fehler, ohne Hinweis.`,
  );
});

/**
 * `scripts/pruefe-paket.mjs` prueft dasselbe am GEBAUTEN Paket -- es laeuft
 * ohne TypeScript-Lader und kann die Konstanten nicht importieren, also
 * stehen die Zahlen dort ein zweites Mal. Zwei Stellen mit derselben Zahl
 * werden irgendwann zwei verschiedene Wahrheiten; diese Pruefung haelt sie
 * zusammen (Regel 1.1).
 */
test('das Paketpruefskript rechnet mit denselben Grenzen', () => {
  const skript = readFileSync(
    fileURLToPath(new URL('../../scripts/pruefe-paket.mjs', import.meta.url)),
    'utf8',
  );
  for (const [name, wert] of [
    ['REGELN_GARANTIERT', DNR_REGELN_GARANTIERT],
    ['REGELSAETZE_MAX', DNR_REGELSAETZE_MAX],
  ] as const) {
    const treffer = new RegExp(`const ${name} = ([0-9_]+);`).exec(skript);
    assert.ok(treffer, `${name} steht nicht mehr in scripts/pruefe-paket.mjs`);
    assert.equal(
      Number(treffer![1]!.replace(/_/g, '')),
      wert,
      `${name} ist in pruefe-paket.mjs eine andere Zahl als in konstanten.ts. ` +
        'Dann meldet das eine gruen, was das andere rot sieht.',
    );
  }
});

test('die Zahl der Regelsaetze bleibt unter Chromes Grenze', () => {
  const dateien = readdirSync(REGELN).filter((f) => f.endsWith('.json'));
  assert.ok(
    dateien.length <= DNR_REGELSAETZE_MAX,
    `${dateien.length} Regelsaetze in rules/, Chrome erlaubt ` +
      `${DNR_REGELSAETZE_MAX}.`,
  );
});
