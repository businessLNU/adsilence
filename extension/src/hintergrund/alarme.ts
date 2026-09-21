/**
 * Alarme sind der Takt des Service Workers: Er lebt nicht lange genug fuer
 * `setInterval`, und ein Alarm weckt ihn auch, wenn er schlaeft.
 *
 * `lizenz` alle 360 min; `verbindung` alle 30 s nur, solange ein Code offen
 * ist (angelegt in konto.ts, geloescht, sobald die Verbindung steht).
 */

import { api } from '../gemeinsam/browser.ts';
import { pflegeListen } from './listenpflege.ts';
import { ALARM_LISTENPFLEGE, ALARM_LIZENZ, ALARM_VERBINDUNG, LISTENPFLEGE_TAKT_MIN, LIZENZ_TAKT_MIN } from '../gemeinsam/konstanten.ts';
import { verbindungFortsetzen } from './konto.ts';
import { lizenzPruefen } from './lizenz.ts';

export async function alarmeEinrichten(): Promise<void> {
  const alarms = api.alarms as typeof chrome.alarms | undefined;
  if (!alarms) return;
  try {
    // Nicht neu anlegen, wenn er schon laeuft: `create` setzt den Takt zurueck,
    // und bei jedem Start des Workers verschoebe sich die Pruefung nach hinten.
    const alt = await alarms.get(ALARM_LIZENZ);
    if (!alt) await alarms.create(ALARM_LIZENZ, { periodInMinutes: LIZENZ_TAKT_MIN, delayInMinutes: 1 });

    // Die Listenpflege laeuft einmal am Tag. `delayInMinutes: 5` und nicht
    // sofort: Der erste Start eines Browsers hat Wichtigeres zu tun, als
    // achtzehn Filterlisten zu laden.
    const altePflege = await alarms.get(ALARM_LISTENPFLEGE);
    if (!altePflege) await alarms.create(ALARM_LISTENPFLEGE, { periodInMinutes: LISTENPFLEGE_TAKT_MIN, delayInMinutes: 5 });
  } catch (e) {
    console.warn('[AdSilence] Alarm', e);
  }
}

export function registriereAlarme(): void {
  const alarms = api.alarms as typeof chrome.alarms | undefined;
  if (!alarms) return;
  alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_LIZENZ) void lizenzPruefen('alarm');
    if (alarm.name === ALARM_LISTENPFLEGE) void pflegeListen().catch(() => {});
    else if (alarm.name === ALARM_VERBINDUNG) void verbindungFortsetzen();
  });
}
