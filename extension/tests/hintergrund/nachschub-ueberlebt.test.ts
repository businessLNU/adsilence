/**
 * Der taegliche Nachschub muss ueberleben, wenn jemand eine Ausnahme setzt.
 *
 * ── Der Fehler, gegen den diese Datei steht ───────────────────────────────
 * `aktualisiereDynamischeRegeln()` loeschte ALLE dynamischen Regeln und setzte
 * danach nur Ausnahmen und eigene Regeln wieder ein. Die 3000 nachgeladenen
 * Regeln (IDs ab `ID_LISTENPFLEGE_VON`) fielen dabei mit weg, und
 * `pflegeNachholen()` holte sie erst wieder, wenn der letzte Lauf ueber 26
 * Stunden her war.
 *
 * Aufgerufen wird die Funktion bei jedem Browserstart, bei jeder
 * Seitenausnahme, bei jeder eigenen Regel und nach jedem Kontoabgleich. Wer
 * morgens den Browser startete und mittags eine Seite auf die Ausnahmeliste
 * setzte, hatte den BEZAHLTEN Nachschub bis zum naechsten Tag verloren — und
 * nirgends stand etwas davon.
 *
 * Der Test haelt fest, was die Funktion anfassen darf: ihre eigenen beiden
 * Bereiche, sonst nichts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereApi } from './attrappe.ts';

/** Was `updateDynamicRules` zu sehen bekommt — je Aufruf ein Eintrag. */
const laeufe: { removeRuleIds?: number[]; addRules?: { id: number }[] }[] = [];

/** Der Zustand, den `getDynamicRules` meldet: aus allen drei Bereichen etwas. */
const vorhanden = [
  { id: 1 }, // Ausnahme
  { id: 1001 }, // eigene Regel
  { id: 2000 }, // Nachschub, erste
  { id: 2500 }, // Nachschub, mittendrin
  { id: 4999 }, // Nachschub, letzte
];

installiereApi({
  api: {
    declarativeNetRequest: {
      getDynamicRules: async () => vorhanden,
      updateDynamicRules: async (auftrag: { removeRuleIds?: number[]; addRules?: { id: number }[] }) => {
        laeufe.push(auftrag);
      },
      getEnabledRulesets: async () => [],
      updateEnabledRulesets: async () => {},
      getAvailableStaticRuleCount: async () => 30000,
    },
  },
});

const { aktualisiereDynamischeRegeln } = await import('../../src/hintergrund/regeln.ts');
const { ID_LISTENPFLEGE_VON, BUDGET_EIGENE, ID_EIGENE_VON } = await import('../../src/gemeinsam/konstanten.ts');

test('geloescht wird nur unterhalb des Nachschubbereichs', async () => {
  laeufe.length = 0;
  await aktualisiereDynamischeRegeln();

  assert.equal(laeufe.length, 1, 'genau ein Schreibvorgang, kein Abgleich einzelner IDs');
  const weg = laeufe[0]!.removeRuleIds ?? [];

  for (const id of [2000, 2500, 4999]) {
    assert.ok(
      !weg.includes(id),
      `Regel ${id} liegt im Nachschubbereich und wurde geloescht. Genau das kostete den ` +
        'zahlenden Kunden seine nachgeladenen Regeln, sobald er eine Ausnahme setzte.',
    );
  }
  for (const id of [1, 1001]) {
    assert.ok(weg.includes(id), `Regel ${id} gehoert dieser Funktion und muesste ersetzt werden.`);
  }
});

/**
 * Die Bereiche muessen sich beruehren, ohne sich zu ueberschneiden: Zwischen
 * der letzten eigenen Regel und der ersten des Nachschubs darf keine ID
 * liegen, die in beide faellt — sonst loescht die eine Seite, was die andere
 * gerade geschrieben hat, und der Test oben merkt es nicht.
 */
test('eigene Regeln enden, bevor der Nachschub beginnt', () => {
  assert.ok(
    ID_EIGENE_VON + BUDGET_EIGENE <= ID_LISTENPFLEGE_VON,
    `Eigene Regeln reichen bis ${ID_EIGENE_VON + BUDGET_EIGENE - 1}, der Nachschub beginnt bei ` +
      `${ID_LISTENPFLEGE_VON}. Die Bereiche ueberschneiden sich.`,
  );
});
