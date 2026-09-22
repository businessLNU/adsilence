/**
 * Der Safari-Bau darf nicht zum Kauf auffordern.
 *
 *     npm test
 *
 * ── Woran das haengt ───────────────────────────────────────────────────────
 * Richtlinie 3.1.1 der App-Store-Pruefung verbietet Knoepfe, Links und
 * Aufforderungen zu einem anderen Kaufweg als dem In-App-Kauf, wenn die
 * Funktion in der App freigeschaltet wird. Ein Knopf „Premium holen", der
 * `adsilence.net/preise` oeffnet, ist genau das.
 *
 * Bei Chrome und Firefox ist derselbe Knopf voellig normal. Die Unterscheidung
 * steht deshalb am ZIEL — und genau deshalb faellt sie beim naechsten Umbau
 * leicht wieder heraus, ohne dass es jemand merkt: Wer auf Chrome entwickelt,
 * sieht den Knopf ja.
 *
 * Gelesen wird der Quelltext, nicht das Modul: `UMGEBUNG.browser` steht erst
 * nach dem Bauen fest, und ein Test, der den Bau nachstellt, pruefte den Bau
 * und nicht die Absicht.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WAHL = join(WURZEL, 'src', 'oberflaeche', 'PremiumWahl.tsx');
const LISTEN = join(WURZEL, 'src', 'optionen', 'teile', 'Filterlisten.tsx');

test('der Kaufweg haengt am Ziel, nicht an einer Einstellung', () => {
  const text = readFileSync(WAHL, 'utf8');
  assert.match(
    text,
    /export const KAUFWEG_ERLAUBT\s*=\s*UMGEBUNG\.browser\s*!==\s*'safari'/,
    'KAUFWEG_ERLAUBT muss aus UMGEBUNG.browser abgeleitet sein',
  );
  assert.match(text, /if \(!KAUFWEG_ERLAUBT\) return null;/, 'PremiumWahl muss ohne Kaufweg nichts rendern');
});

/*
 * Jede Stelle, die die Preisseite oeffnet, muss vorher fragen. Kommt eine
 * dritte dazu, faellt sie hier auf — sonst faende man sie erst in der
 * Ablehnung von Apple wieder.
 */
test('jede Stelle, die die Preisseite oeffnet, prueft den Kaufweg', () => {
  for (const datei of [WAHL, LISTEN]) {
    const text = readFileSync(datei, 'utf8');
    const oeffnet = (text.match(/oeffneTab\(preisseite\(\)\)/g) ?? []).length;
    if (oeffnet === 0) continue;
    assert.ok(
      text.includes('KAUFWEG_ERLAUBT'),
      `${datei} oeffnet die Preisseite, prueft aber KAUFWEG_ERLAUBT nicht`,
    );
  }
});
