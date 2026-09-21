/**
 * Inhaltsskript, isolierte Welt: das Cookie-Fenster beantworten.
 *
 * ── Warum klicken und nicht verstecken ─────────────────────────────────────
 * Die Filterliste `cookies` blendet die Fenster aus. Sie sind dann weg, aber
 * UNBEANTWORTET: Viele Seiten zeigen sie beim naechsten Besuch wieder, manche
 * sperren ihren Inhalt, bis eine Antwort da ist. Ein Klick beendet die Frage
 * ein fuer alle Mal - fuer diese Seite, in deren eigenem Speicher.
 *
 * ── Warum es auf ein Fenster WARTET ────────────────────────────────────────
 * Einwilligungswerkzeuge laden sich fast immer nach: erst die Seite, dann ein
 * fremdes Skript, dann das Fenster. Zum Zeitpunkt von `document_start` ist
 * nichts davon da. Ein einmaliger Blick fände also nie etwas; deshalb ein
 * MutationObserver mit einem Deckel von zwoelf Sekunden. Danach wird er
 * abgeschaltet - ein Beobachter, der stundenlang jede Aenderung einer Seite
 * durchsieht, ist genau die Sorte Erweiterung, die Rechner langsam macht.
 *
 * ── Was NICHT passiert ─────────────────────────────────────────────────────
 * Es wird nie nach Knopfbeschriftungen gesucht. Nur wenn die Kennung eines
 * BEKANNTEN Werkzeugs auf der Seite steht, wird ueberhaupt geklickt, und dann
 * genau der Knopf, den dieses Werkzeug dafuer vorsieht. Auf einer Bestellseite
 * steht „Akzeptieren" auch am Kaufknopf.
 */

import { api } from '../gemeinsam/browser.ts';
import { findeKnopf, type Antwort } from '../gemeinsam/cookies.ts';

/** Wie lange auf ein nachgeladenes Fenster gewartet wird. */
const FRIST_MS = 12_000;
/** Hoechstens so oft klicken - manche Werkzeuge fragen in zwei Stufen. */
const MAX_KLICKS = 2;

/**
 * Ist dieser Knopf ANKLICKBAR?
 *
 * Bewusst NICHT „ist er sichtbar". Das war die erste Fassung, und sie stand
 * gegen die eigene Erweiterung:
 *
 * GEMESSEN am 03.09.2026 an einem OneTrust-Banner: `#onetrust-banner-sdk`
 * hatte `display: none`, der Knopf darin eine Breite von 0. Nicht die Seite
 * hatte das getan, sondern die Filterliste `cookies` - sie VERSTECKT
 * Einwilligungsfenster, und das ist ihre Aufgabe. Der Klicker sah daraufhin
 * einen unsichtbaren Knopf und liess die Finger davon. Zwei Funktionen
 * derselben Erweiterung arbeiteten gegeneinander, und beide taten genau das,
 * wofuer sie gebaut waren.
 *
 * Ein verstecktes Element laesst sich trotzdem klicken: `.click()` loest den
 * Ereignisfluss aus, ganz gleich, ob etwas zu sehen ist. Und die Sicherheit
 * haengt ohnehin nicht an der Sichtbarkeit, sondern daran, dass ueberhaupt
 * nur Knoepfe BEKANNTER Einwilligungswerkzeuge in Frage kommen (siehe
 * `gemeinsam/cookies.ts`).
 *
 * Geprueft wird deshalb nur noch: Haengt das Element im Dokument, und ist es
 * nicht ausdruecklich abgeschaltet? Ein `disabled`-Knopf ist einer, den auch
 * ein Mensch nicht druecken koennte.
 */
function klickbar(element: Element): boolean {
  const el = element as HTMLElement;
  if (!el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function ersterKlickbarer(selektor: string): HTMLElement | null {
  let treffer: NodeListOf<Element>;
  try {
    treffer = document.querySelectorAll(selektor);
  } catch {
    return null;
  }
  for (const el of treffer) if (klickbar(el)) return el as HTMLElement;
  return null;
}

let geklickt = 0;

function versuche(antwort: Antwort): boolean {
  const fund = findeKnopf(
    antwort,
    (selektor) => {
      try {
        return document.querySelector(selektor) !== null;
      } catch {
        return false;
      }
    },
    (selektor) => ersterKlickbarer(selektor) !== null,
  );
  if (!fund) return false;
  const knopf = ersterKlickbarer(fund.selektor);
  if (!knopf) return false;
  knopf.click();
  geklickt += 1;
  return true;
}

async function starte(): Promise<void> {
  let antwort: Antwort | null = null;
  try {
    const ergebnis = (await api.runtime.sendMessage({ typ: 'cookies.antwort' })) as
      | { ok: true; antwort: Antwort | null }
      | { ok: false }
      | undefined;
    if (!ergebnis || !('ok' in ergebnis) || !ergebnis.ok) return;
    antwort = ergebnis.antwort;
  } catch {
    return;
  }
  if (!antwort) return;

  // Ein MutationObserver ALLEIN genuegt nicht.
  //
  // GEMESSEN am 03.09.2026: Ein OneTrust-Banner, das schon im ausgelieferten
  // HTML steht, wurde nicht geklickt, ein nachgeladenes Cookiebot-Fenster
  // dagegen schon. Der Grund ist der Zeitpunkt: Bei `document_start` meldet
  // der Observer das Element, sobald der Parser es einfuegt - aber der
  // Browser hat es dann noch nicht gelayoutet. `getBoundingClientRect()` gibt
  // 0 zurueck, `sichtbar()` sagt nein, und der Beobachter feuert danach nie
  // wieder, weil sich am DOM nichts mehr aendert.
  //
  // Deshalb zusaetzlich ein Takt: alle 250 ms nachsehen, bis die Frist um ist.
  // Das kostet bei einer Seite ohne Einwilligungsfenster achtundvierzig
  // erfolglose `querySelector`-Aufrufe ueber zwoelf Sekunden - messbar wenig,
  // und danach ist Ruhe.
  const wache = new MutationObserver(() => void pruefen());
  let takt: ReturnType<typeof setInterval> | null = null;

  function beenden(): void {
    wache.disconnect();
    if (takt !== null) clearInterval(takt);
    takt = null;
  }

  function pruefen(): void {
    if (versuche(antwort!) && geklickt >= MAX_KLICKS) beenden();
  }

  pruefen();
  if (geklickt >= MAX_KLICKS) return;
  wache.observe(document.documentElement, { childList: true, subtree: true });
  takt = setInterval(pruefen, 250);
  setTimeout(beenden, FRIST_MS);
}

void starte();
