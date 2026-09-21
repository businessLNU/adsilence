/**
 * Das Sitzungs-Token fuer „Fingerabdruck verwischen", und seine Bindung an
 * die oberste Seite.
 *
 * Die Hauptwelt (`inhalt/fingerabdruck.ts`) verrauscht Canvas und Audio mit
 * einem Seed. Woher der Seed kommt, entscheidet, was ein Tracker sieht:
 *
 * - Ein FESTER Seed (je Installation) waere selbst ein Merkmal: Das Rauschen
 *   ist dann Tag fuer Tag dasselbe, und der verrauschte Hash ersetzt nur den
 *   echten. Genau das misst Cover Your Tracks als „unique".
 * - Ein Seed JE SEITENAUFRUF bricht Seiten, die den Wert innerhalb einer
 *   Sitzung vergleichen (Zahlungsrahmen, Bot-Schutz), und ist als
 *   Fingerabdruck erkennbar „zu zufaellig".
 * - Ein Seed je BROWSERSITZUNG und OBERSTER SEITE ist der Mittelweg, den
 *   auch Brave geht: Auf derselben Seite bleibt der Wert stabil, bis der
 *   Browser zugeht; zwei Seiten sehen zwei verschiedene Werte, und morgen
 *   sehen sie wieder andere.
 *
 * Die Stabilitaet gilt fuer alles, was NACH der Antwort des Hintergrunds
 * liest (Canvas wie Audio; Canvas seit dem 05.09.2026 mit einem Salz aus
 * der laufenden Elementnummer statt aus Zufall). Ein synchrones Skript im
 * `head` liegt vor dieser Antwort und bekommt einen Seed je Seitenaufruf;
 * das ist die Grenze der Bauart und steht in `inhalt/fingerabdruck.ts`
 * (`holeSeed`) und im Katalog.
 *
 * Deshalb liegt das Token in `storage.session` (lebt mit der Browsersitzung,
 * nicht mit dem Service Worker, der alle dreissig Sekunden einschlaeft), und
 * deshalb bekommt eine Seite nie das Token selbst, sondern nur eine
 * Ableitung aus Token und oberster Seite. Was die Hauptwelt zu sehen bekommt,
 * kann die Seite lesen; aus der Ableitung fuer `a.example` darf sich die fuer
 * `b.example` nicht rechnen lassen.
 *
 * WARUM DIE OBERSTE SEITE UND NICHT DER RAHMEN-HOST: Mit dem Rahmen-Host
 * bekaeme ein Rahmen von `doubleclick.net` auf JEDER besuchten Seite
 * denselben Seed und saehe auf Seite A und Seite B denselben Audio-Wert.
 * Das ist der Tracking-Fall, gegen den die Schicht gebaut ist.
 */

import { api } from '../gemeinsam/browser.ts';
import { liesSitzung, schreibeSitzung } from '../gemeinsam/speicher.ts';

/** Kein Zwischenspeicher im Modul: `storage.session` ist die eine Quelle. */
let laufend: Promise<string> | null = null;

/**
 * Rueckfall, wenn es `storage.session` nicht gibt (Safari vor 16.4): Dann
 * lebt das Token so lange wie der Hintergrundprozess. Kuerzer als eine
 * Browsersitzung, aber der einzige Ort, der dort noch bleibt.
 */
let ohneSitzungsspeicher: string | null = null;

function neuesToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Ohne `randomUUID` (sehr alte Umgebung): 16 Zufallsbytes als Hex, dieselbe
  // Entropie.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

async function ermittle(): Promise<string> {
  const { fingerabdruckToken } = await liesSitzung('fingerabdruckToken');
  if (fingerabdruckToken) return fingerabdruckToken;
  if (!api.storage.session) {
    ohneSitzungsspeicher ??= neuesToken();
    return ohneSitzungsspeicher;
  }
  const token = neuesToken();
  await schreibeSitzung({ fingerabdruckToken: token });
  return token;
}

/**
 * Das Token dieser Browsersitzung: einmal erzeugt, danach aus
 * `storage.session` gelesen. Gleichzeitige Aufrufe (zwanzig Rahmen einer
 * Seite fragen auf einmal) teilen sich EINE Ermittlung, sonst schriebe jeder
 * ein eigenes Token und der letzte gewaenne - die ersten Rahmen haetten dann
 * ein anderes Token als der Rest der Sitzung.
 *
 * Bewusst keine Kopie im Modul: Sie und `storage.session` waeren zwei Orte
 * fuer einen Wert, und bei einem geleerten Sitzungsspeicher stimmten sie
 * nicht mehr ueberein. Ein `storage.session.get` je Rahmen ist billig; die
 * Kosmetik liest fuer denselben Rahmen ohnehin zweimal aus `local`.
 */
export function sitzungsToken(): Promise<string> {
  if (!laufend) {
    laufend = ermittle().finally(() => {
      laufend = null;
    });
  }
  return laufend;
}

/**
 * SHA-256 ueber `token|top`, als Hex. Eine echte Einwegfunktion und nicht der
 * 32-Bit-Hash der Hauptwelt: Was hier herauskommt, landet auf der Seite, und
 * aus einem 32-Bit-Wert liesse sich das Token zwar nicht zurueckrechnen, wohl
 * aber liesse sich mit 2^32 Versuchen je Seite pruefen, ob zwei Seiten
 * dasselbe Token teilen. `crypto.subtle` gibt es im Service Worker, in der
 * Event Page und in Node; die Hauptwelt hasht den Text danach noch einmal
 * mit ihrem eigenen Host (`seedAus`).
 */
async function ableiten(token: string, top: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${token}|${top}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Das Token, das die Rahmen unter der obersten Seite `top` bekommen.
 * Derselbe Rahmen-Host unter zwei obersten Seiten bekommt zwei verschiedene;
 * dieselbe oberste Seite bekommt in dieser Browsersitzung immer dasselbe.
 */
export async function tokenFuerSeite(top: string): Promise<string> {
  return ableiten(await sitzungsToken(), top.toLowerCase());
}
