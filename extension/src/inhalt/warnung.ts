/**
 * Inhaltsskript, ISOLIERTE Welt: zeigt die Verwechslungswarnung auf der Seite.
 *
 * ── Fuer wen das gebaut ist ────────────────────────────────────────────────
 * Fuer jemanden, der die Seite fuer echt haelt. Also nicht fuer den, der
 * Warnungen liest, sondern fuer den, der sie uebersieht. Daraus folgt alles
 * andere:
 *
 *   - Sie liegt UEBER der Seite und nicht daneben. Ein Balken oben wird
 *     weggescrollt und mitgelesen wie ein Cookie-Banner.
 *   - Der grosse, farbige Knopf fuehrt WEG. Der kleine, graue bleibt.
 *     Bei einem Bedienelement, das im Zweifel falsch getroffen wird, muss
 *     der sichere Ausgang der bequemere sein.
 *   - Sie nennt beide Adressen untereinander, in gleicher Schrift: die
 *     aufgerufene und die echte. Der Unterschied soll zu SEHEN sein, nicht
 *     erklaert werden muessen.
 *   - Kein Countdown, kein automatisches Schliessen. Wer langsam liest, soll
 *     zu Ende lesen koennen.
 *
 * ── Warum ein Shadow Root ──────────────────────────────────────────────────
 * Die Warnung erscheint auf einer Seite, die den Nutzer taeuschen will. Deren
 * CSS darf sie nicht erreichen: Ein `div { display: none }` der fremden Seite
 * wuerde sie sonst unsichtbar machen. Ein geschlossener Shadow Root mit
 * eigenem Stylesheet ist dagegen dicht, und `all: initial` auf dem Wirt
 * schneidet die Vererbung ab.
 */

import { api } from '../gemeinsam/browser.ts';
import { baue, KENNUNG_WARNKARTE as KENNUNG, type Texte, type Verdacht } from '../oberflaeche/warnkarte.ts';

/**
 * Das Inhaltsskript FRAGT, der Hintergrund antwortet - nicht umgekehrt.
 *
 * GEMESSEN am 03.09.2026: Beim umgekehrten Weg schickte der Hintergrund die
 * Warnung bei `webNavigation.onCommitted`, und das ist zu frueh. Dieses
 * Skript laeuft bei `document_idle`, es gab also noch keinen Empfaenger;
 * `sendMessage` scheiterte, der `catch` verschluckte es, und auf
 * `paypal-login.xyz` blieb die Warnung aus, waehrend sie auf `paypa1.com`
 * zufaellig noch ankam. Ein Wettlauf, den man nur bemerkt, wenn man ihn
 * zufaellig verliert.
 *
 * Andersherum gibt es keinen Wettlauf: Wenn dieses Skript laeuft, steht der
 * Empfaenger fest - es ist der Hintergrund, und den weckt die Anfrage.
 *
 * ── Warum `document_start` und nicht `document_idle` ────────────────────
 * Die Warnung soll da sein, BEVOR das Anmeldeformular zu sehen ist. Bei
 * `document_idle` laeuft das Skript erst, wenn die Seite fertig gezeichnet
 * ist; wer schnell tippt, hat Benutzername und Passwort dann schon halb
 * eingegeben. Genau davor soll dieses Werkzeug schuetzen, also fragt es so
 * frueh, wie ein Inhaltsskript ueberhaupt laufen kann.
 *
 * Bei `document_start` gibt es `document.body` noch nicht. Die Karte haengt
 * deshalb notfalls am `documentElement` und wird umgehaengt, sobald der Body
 * entsteht - sonst raeumt der Parser sie beim Aufbau des Bodys mit weg.
 *
 * ── Und warum es einen zweiten Versuch gibt ────────────────────────────────
 * Ein schlafender Service Worker wird von der Anfrage geweckt, aber die erste
 * Nachricht an einen startenden Worker kann verlorengehen. Bei einem
 * Werbeblocker waere das ein Schoenheitsfehler; bei einer Warnung vor einer
 * gefaelschten Bankseite ist es der Unterschied, um den es geht. Zwei
 * Versuche kosten nichts, wenn der erste klappt.
 */
async function frage(): Promise<{ verdacht: Verdacht | null; texte: Texte | null } | null> {
  try {
    const antwort = (await api.runtime.sendMessage({ typ: 'verwechslung.pruefen', host: location.hostname })) as
      | { ok: true; verdacht: Verdacht | null; texte: Texte | null }
      | { ok: false }
      | undefined;
    if (!antwort || !('ok' in antwort) || !antwort.ok) return null;
    return { verdacht: antwort.verdacht, texte: antwort.texte };
  } catch {
    return null;
  }
}

/** Die Karte anhaengen, auch wenn es den Body noch nicht gibt. */
function haenge(karte: HTMLElement): void {
  const body = document.body;
  if (body) {
    body.append(karte);
    return;
  }
  document.documentElement.append(karte);
  // Sobald der Body da ist, umhaengen: Was beim Aufbau am documentElement
  // haengt, raeumt der Parser sonst mit weg.
  const wache = new MutationObserver(() => {
    if (!document.body) return;
    wache.disconnect();
    if (karte.isConnected) document.body.append(karte);
  });
  wache.observe(document.documentElement, { childList: true });
}

async function fragen(): Promise<void> {
  for (let versuch = 0; versuch < 2; versuch++) {
    if (document.getElementById(KENNUNG)) return;
    const antwort = await frage();
    if (antwort?.verdacht && antwort.texte) {
      if (document.getElementById(KENNUNG)) return;
      haenge(baue(antwort.verdacht, antwort.texte));
      return;
    }
    // Eine klare Antwort „nichts gefunden" ist das Ende; nur ein
    // AUSBLEIBEN der Antwort ist einen zweiten Versuch wert.
    if (antwort !== null) return;
    await new Promise((fertig) => setTimeout(fertig, 300));
  }
}

void fragen();
