/**
 * Was beide Seiten vor dem ersten Zeichnen tun: Sprache und Erscheinungsbild
 * aus den Einstellungen holen und am `<html>` eintragen. Erst danach wird
 * gerendert, sonst blitzte eine Sekunde Englisch in Hell auf, bevor Deutsch
 * in Dunkel kommt.
 *
 * Danach bleibt ein Ohr am Speicher: Aendert die Optionsseite die Sprache,
 * zieht ein offenes Popup mit.
 */
import { setzeSprache } from './i18n.ts';
import { beiSpeicherAenderung, leseSpeicher } from './laufzeit.ts';
import { wendeThemaAn } from './thema.ts';

export async function starteOberflaeche(): Promise<void> {
  try {
    const { einstellungen } = await leseSpeicher('einstellungen');
    setzeSprache(einstellungen.sprache);
    wendeThemaAn(einstellungen.thema);
  } catch {
    // Kein Speicher (weder Paket noch Attrappe): Browsersprache, Systemthema.
    // Die Seite zeigt gleich den Fehlerzustand; lesbar soll er trotzdem sein.
    setzeSprache(null);
    wendeThemaAn('system');
  }
  beiSpeicherAenderung((a) => {
    if (!a.einstellungen) return;
    setzeSprache(a.einstellungen.sprache);
    wendeThemaAn(a.einstellungen.thema);
  });
}
