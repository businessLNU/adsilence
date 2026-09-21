/**
 * Einstieg des Hintergrunds (Service Worker in Chromium, Event Page in
 * Firefox und Safari).
 *
 * MV3-Regel: Jeder Lauscher wird SYNCHRON beim Laden registriert. Ein
 * `await` davor, und der Browser weckt den Worker fuer ein Ereignis, findet
 * keinen Lauscher und verwirft es. Alles Langsame steht in `einrichten()`
 * und laeuft, nachdem die Lauscher stehen.
 */

import { api } from '../gemeinsam/browser.ts';
import { migriereSpeicher } from '../gemeinsam/speicher.ts';
import { alarmeEinrichten, registriereAlarme } from './alarme.ts';
import { allesAnwenden } from './anwenden.ts';
import { sitzungsToken } from './fingerabdruck.ts';
import { verbindungFortsetzen } from './konto.ts';
import { lizenzPruefen, registriereKaufRueckkehr } from './lizenz.ts';
import { registriereNachrichten } from './nachrichten.ts';
import { pflegeNachholen } from './listenpflege.ts';
import { waehleRegionaleListe } from './regeln.ts';
import { aktualisiereDynamischeRegeln } from './regeln.ts';
import { registrierePopupWaechter } from './popup.ts';
import { registriereScriptlets } from './scriptlets.ts';

registriereNachrichten();
registriereAlarme();
registriereScriptlets();
registrierePopupWaechter();
registriereKaufRueckkehr();

api.runtime.onInstalled.addListener((details) => {
  void einrichten(details.reason);
});

// Safari kennt `onStartup` nicht in jeder Version.
const onStartup = api.runtime.onStartup as typeof chrome.runtime.onStartup | undefined;
if (onStartup) {
  onStartup.addListener(() => {
    void einrichten('startup');
  });
}

// Bei jedem Aufwachen: Liegt ein Verbindungscode offen, weiter abholen.
// Billig, wenn keiner offen ist (ein Speicherzugriff).
void verbindungFortsetzen();

// Das Sitzungs-Token fuer das Rauschen liegt in `storage.session` und
// ueberlebt dort jeden Schlaf des Workers; hier wird es nur angelegt, falls
// es noch fehlt (erster Start der Browsersitzung). Ohne `await`: Kein
// Lauscher haengt daran, und die erste Kosmetik-Anfrage holt es sich sonst
// selbst.
void sitzungsToken().catch(() => {});

/**
 * Speicher migrieren, Alarm stellen, Rulesets und Kosmetik nach
 * Einstellungen und Lizenz schalten, dynamische Regeln aus Ausnahmen und
 * eigenen Regeln neu aufbauen, dann die Lizenz nachfragen.
 */
async function einrichten(anlass: string): Promise<void> {
  try {
    await migriereSpeicher();
    await alarmeEinrichten();
    // VOR `allesAnwenden`: Die Wahl schreibt die Einstellung, und erst danach
    // werden die Rulesets danach geschaltet.
    await waehleRegionaleListe();
    await allesAnwenden();
    await aktualisiereDynamischeRegeln();
    void lizenzPruefen(anlass);
    // Nachholen, falls der Alarm zu lange nicht gefeuert hat (Rechner aus).
    void pflegeNachholen().catch(() => {});
  } catch (e) {
    console.error('[AdSilence] Einrichten', anlass, e);
  }
}
