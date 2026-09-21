/**
 * Die Warnkarte: das Fenster, das ueber einer verdaechtigen Seite liegt.
 *
 * Steht hier und nicht im Inhaltsskript, weil ZWEI Stellen sie zeigen: die
 * Seite selbst (`inhalt/warnung.ts`) und der Knopf „Ausprobieren" in den
 * Optionen. Zwei Nachbauten derselben Karte liefen frueher oder spaeter
 * auseinander, und dann zeigte die Vorschau etwas anderes als der Ernstfall.
 *
 * ── Fuer wen sie gebaut ist ────────────────────────────────────────────────
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

export const KENNUNG_WARNKARTE = "adsilence-verwechslungswarnung";

export type Verdacht = { host: string; lesbar?: string | null; marke: string; echt: string; grund: string };

const KENNUNG = KENNUNG_WARNKARTE;

/** Texte kommen aus dem Hintergrund; das Inhaltsskript kennt keinen Katalog. */
export type Texte = { titel: string; satz: string; aufgerufen: string; echte: string; weg: string; bleiben: string };

export function baue(verdacht: Verdacht, texte: Texte, nurZeigen = false): HTMLElement {
  const wirt = document.createElement('div');
  wirt.id = KENNUNG;
  // `all: initial` kappt jede Vererbung der fremden Seite; der Rest steht im
  // Shadow Root und ist von aussen nicht erreichbar.
  wirt.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
  const wurzel = wirt.attachShadow({ mode: 'closed' });

  const stil = document.createElement('style');
  stil.textContent = `
    :host { all: initial; }
    .grund {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(8, 11, 16, 0.72); padding: 24px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .karte {
      max-width: 520px; width: 100%; background: #fff; color: #14181f;
      border-radius: 16px; padding: 28px; box-shadow: 0 24px 64px rgba(0,0,0,0.35);
    }
    .zeichen { font-size: 40px; line-height: 1; }
    h1 { margin: 12px 0 8px; font-size: 24px; font-weight: 800; letter-spacing: -0.01em; }
    p { margin: 0 0 16px; font-size: 15px; line-height: 1.55; color: #3a424f; }
    dl { margin: 0 0 20px; display: grid; gap: 10px; }
    dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6472; }
    dd {
      margin: 2px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 16px; word-break: break-all;
    }
    .falsch dd { color: #b91c1c; }
    .echt dd { color: #15803d; }
    .knoepfe { display: grid; gap: 8px; }
    button { font: inherit; border-radius: 10px; padding: 14px 18px; cursor: pointer; border: 0; }
    /* Feste Werte und keine Variablen: Diese Karte wird in eine FREMDE Seite
       gehaengt, wo tokens.css nicht gilt. Sie tragen dieselbe Marke wie das
       Popup (#e65909 / #f6821f) und muessen mit ihr nachgezogen werden.
       Die Schrift ist dunkel, weil Weiss auf diesem Orange bei 3,6:1 steht.
       (Keine Backticks in diesem Kommentar: Er steht IN einem Template-
       Literal, und der erste beendete es — der Typecheck fiel darauf um.) */
    .weg { background: #e65909; color: #1a0702; font-weight: 700; font-size: 16px; }
    .weg:hover { background: #f6821f; }
    .bleiben { background: none; color: #5b6472; font-size: 13px; text-decoration: underline; }
    @media (prefers-reduced-motion: no-preference) {
      .karte { animation: auf 160ms ease-out; }
      @keyframes auf { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }
    }
  `;

  const grund = document.createElement('div');
  grund.className = 'grund';
  grund.setAttribute('role', 'alertdialog');
  grund.setAttribute('aria-modal', 'true');

  const karte = document.createElement('div');
  karte.className = 'karte';

  const zeichen = document.createElement('div');
  zeichen.className = 'zeichen';
  zeichen.textContent = '⚠️';

  const titel = document.createElement('h1');
  titel.textContent = texte.titel;

  const satz = document.createElement('p');
  satz.textContent = texte.satz;

  const liste = document.createElement('dl');
  const aufgerufen = verdacht.lesbar ? `${verdacht.lesbar}  (${verdacht.host})` : verdacht.host;
  for (const [klasse, beschriftung, wert] of [
    ['falsch', texte.aufgerufen, aufgerufen],
    ['echt', texte.echte, verdacht.echt],
  ] as const) {
    const gruppe = document.createElement('div');
    gruppe.className = klasse;
    const dt = document.createElement('dt');
    dt.textContent = beschriftung;
    const dd = document.createElement('dd');
    dd.textContent = wert;
    gruppe.append(dt, dd);
    liste.append(gruppe);
  }

  const knoepfe = document.createElement('div');
  knoepfe.className = 'knoepfe';
  const weg = document.createElement('button');
  weg.className = 'weg';
  weg.type = 'button';
  weg.textContent = texte.weg;
  weg.addEventListener('click', () => {
    // In der Vorschau (Optionsseite) fuehrt der Knopf nirgendwohin - er
    // schliesst nur. Sonst truege ein Blick auf die Karte den Nutzer aus
    // seinen Einstellungen heraus.
    if (nurZeigen) {
      wirt.remove();
      return;
    }
    // Zurueck, wenn es ein Zurueck gibt; sonst auf eine leere Seite. Auf
    // KEINEN Fall auf die echte Marke weiterleiten: Wir wissen nicht, wohin
    // der Nutzer wollte, und eine Erweiterung, die von selbst zu einer
    // Bankadresse navigiert, waere ein eigenes Risiko.
    if (history.length > 1) history.back();
    else location.replace('about:blank');
  });
  const bleiben = document.createElement('button');
  bleiben.className = 'bleiben';
  bleiben.type = 'button';
  bleiben.textContent = texte.bleiben;
  bleiben.addEventListener('click', () => wirt.remove());
  knoepfe.append(weg, bleiben);

  karte.append(zeichen, titel, satz, liste, knoepfe);
  grund.append(karte);
  wurzel.append(stil, grund);
  // Der sichere Ausgang bekommt den Fokus: Wer die Eingabetaste drueckt, geht.
  queueMicrotask(() => weg.focus());
  return wirt;
}

