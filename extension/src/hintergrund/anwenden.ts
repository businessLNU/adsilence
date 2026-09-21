/**
 * Ein Aufruf, der den Speicher auf den Browser anwendet: Rulesets, generische
 * Kosmetik, Karten der Inhaltsskripte, Badge. Wer Einstellungen oder Lizenz
 * aendert, ruft das hier und sonst nichts; so bleibt nie ein Teil stehen.
 */

import { badgeAktualisieren } from './badge.ts';
import { kosmetikNeuLaden } from './kosmetik.ts';
import { aktualisiereGenerischesCss, schalteRulesets } from './regeln.ts';
import { popupsNeuLaden } from './popup.ts';
import { aktualisiereScriptletSkripte, scriptletsNeuLaden } from './scriptlets.ts';

let laufend: Promise<void> | null = null;
let nochmal = false;

/**
 * Nie zwei Laeufe zugleich; kommt waehrend eines Laufs ein zweiter Wunsch,
 * laeuft danach genau ein weiterer. Zwei parallele `updateEnabledRulesets`
 * mit gegenlaeufigen Listen ergaeben sonst einen Zustand, den keiner wollte.
 */
export function allesAnwenden(): Promise<void> {
  if (laufend) {
    nochmal = true;
    return laufend;
  }
  laufend = (async () => {
    try {
      do {
        nochmal = false;
        kosmetikNeuLaden();
        scriptletsNeuLaden();
        popupsNeuLaden();
        /*
         * Die Scriptlets ZUERST. Sie sind das einzige Glied der Kette, dessen
         * Wirkung an einer Frist haengt: Sie muessen stehen, bevor das erste
         * Skript der Seite laeuft. GEMESSEN am 08.09.2026 direkt nach einem
         * Browserstart -- standen sie an dritter Stelle, kamen sie zu spaet.
         *
         * Die Rulesets haben diese Frist nicht: Welche statischen Regelsaetze
         * an sind, merkt sich der Browser ueber den Neustart hinweg; der
         * Aufruf hier gleicht nur ab.
         */
        await aktualisiereScriptletSkripte();
        await schalteRulesets();
        await aktualisiereGenerischesCss();
        await badgeAktualisieren();
      } while (nochmal);
    } finally {
      laufend = null;
    }
  })();
  return laufend;
}
