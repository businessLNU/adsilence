/**
 * Inhaltsskript, isolierte Welt, `document_start`, alle Rahmen.
 *
 * Aufgabe: die seitenSPEZIFISCHEN Selektoren der aktiven Listen als ein
 * Stylesheet anbringen, bevor die Seite malt. Die generischen Selektoren
 * kommen nicht von hier: Sie liegen in `kosmetik/generisch.css`, das der
 * Hintergrund als registriertes Inhaltsskript einhaengt (noch frueher, und
 * ohne Nachricht).
 *
 * Kein DOM-Scan. Kein `querySelectorAll` ueber das Dokument, kein Vergleich
 * jedes Knotens mit jeder Regel: Die Regel steht im Stylesheet, und der
 * Browser wendet sie an, so wie er es fuer jedes CSS tut. Der
 * MutationObserver hat genau eine Aufgabe: offene Shadow Roots finden, denn
 * ein Stylesheet des Dokuments reicht nicht in sie hinein. Er sieht nur,
 * was NEU dazukommt, und jeden Teilbaum einmal.
 *
 * DIE EINE AUSNAHME, seit dem 08.09.2026: `starteTextlaeufer()` ganz unten.
 * Eine Regel wie `#?#.box:has-text(Werbung)` sieht auf den TEXT eines
 * Elements, und das kann kein Stylesheet. Sie laeuft deshalb wirklich ueber
 * das DOM - aber nur dort, wo es solche Regeln gibt: GEMESSEN tragen 798
 * Hosts welche, im Schnitt 1,45 Stueck. Auf jeder anderen Seite ist die
 * Liste leer, die Funktion wird nie gerufen, und es entsteht kein zweiter
 * Beobachter. Die Begruendung steht ausfuehrlich an der Funktion.
 */

import { api } from '../gemeinsam/browser.ts';
import {
  EREIGNIS_FINGERABDRUCK,
  EREIGNIS_KOSMETIK,
  HANDSCHLAG_ANTWORT,
  HANDSCHLAG_FERTIG,
  HANDSCHLAG_FRAGE,
  kodiere,
} from '../gemeinsam/fingerabdruck-kanal.ts';
import { BROWSER, SELEKTOREN_JE_REGEL } from '../gemeinsam/konstanten.ts';
import type { KosmetikAntwort } from '../gemeinsam/typen.ts';

/**
 * Das Geheimnis des Handschlags mit der Hauptwelt, siehe
 * `gemeinsam/fingerabdruck-kanal.ts`. Es entsteht als ERSTES, vor jedem
 * Ausstieg: Auch ein Rahmen, der gleich keine Nachricht schickt, muss den
 * Handschlag beantworten, sonst wartet die Hauptwelt dort auf eine Antwort,
 * die eine Seite spaeter faelschen koennte.
 */
const geheimnis = handschlag();

(function start() {
  const host = eigenerHost();
  if (host === null) return;

  // `sendMessage` liefert in Chromium wie Firefox ein Promise, sobald kein
  // Callback uebergeben wird.
  let frage: Promise<KosmetikAntwort | undefined>;
  try {
    frage = api.runtime.sendMessage({ typ: 'kosmetik', host }) as Promise<KosmetikAntwort | undefined>;
  } catch {
    return;
  }

  frage
    .then((antwort) => {
      // VOR dem `aus`-Ausstieg: Auch „diese Seite ist Ausnahme" muss die
      // Hauptwelt erfahren, sonst rauscht sie dort weiter.
      if (antwort) reicheFingerabdruck(antwort.fingerabdruck);
      if (!antwort || antwort.aus) return;
      const spezifisch = Array.isArray(antwort.selektoren) ? antwort.selektoren : [];
      if (spezifisch.length) {
        const css = baueCss(spezifisch);
        if (css) {
          anbringen(css);
          reicheAnHauptwelt(css);
        }
      }
      // Regeln, die auf den TEXT sehen. Fast immer eine leere Liste; dann
      // laeuft hier auch nichts.
      const textregeln = Array.isArray(antwort.textregeln) ? antwort.textregeln : [];
      if (textregeln.length) starteTextlaeufer(textregeln);

      // Die generischen Regeln ein zweites Mal, nur fuer Shadow Roots.
      const listen = Array.isArray(antwort.listen) ? antwort.listen : [];
      if (listen.length) spaeter(() => generischeInDenSchatten(listen));
    })
    .catch(() => {
      // Hintergrund nicht erreichbar (Neustart, Update): dann eben ohne
      // seitenspezifische Kosmetik. Die generische liegt schon an.
    });
})();

/**
 * Der Host, fuer den dieser Rahmen fragt.
 *
 * Bei http(s) der eigene. Sonst - `about:blank`, `srcdoc`, `blob:`, `data:` -
 * der des Elternrahmens: Bis zum 05.09.2026 kehrte das Skript hier sofort
 * zurueck, und das Hauptwelt-Skript in solchen Rahmen (es laeuft dort,
 * gemessen) erfuhr nie, ob die Seite eine Ausnahme ist. Editoren und
 * Vorschauen (CodePen, JSFiddle, Mail-Compose, Ad-Slots) leben in genau
 * solchen Rahmen; auf einer freigegebenen Seite haetten sie weiter
 * gerauscht.
 *
 * `location.ancestorOrigins[0]` kennt Chromium; Firefox nicht, dort geht es
 * ueber `parent.location`, das bei fremder Herkunft wirft. Dann ist der Host
 * LEER (`''`), und die Frage geht trotzdem an den Hintergrund: Der kennt die
 * oberste Seite aus `sender.tab.url` und entscheidet an ihr, ob das
 * Rauschen an ist und mit welchem Token. Bis zum 05.09.2026 schwieg der
 * Rahmen stattdessen, und die Hauptwelt rauschte dort mit Zufallsseed
 * weiter - auch bei ausgeschalteter Einstellung, auch auf einer
 * Ausnahmeseite; in Firefox trifft das jeden Werbe-, Zahlungs- und
 * Challenge-Rahmen mit eigenen about:blank-Unterrahmen.
 *
 * `null` nur fuer ein OBERSTES Dokument ohne http(s) (`file:`,
 * Erweiterungsseiten): Dort gibt es keine Seite, die Ausnahme sein koennte,
 * und wie bisher keine Nachricht.
 */
function eigenerHost(): string | null {
  const eigener = location.hostname.toLowerCase();
  if (eigener && (location.protocol === 'http:' || location.protocol === 'https:')) return eigener;
  try {
    const ahnen = location.ancestorOrigins;
    if (ahnen && ahnen.length > 0) {
      const h = new URL(ahnen[0]!).hostname.toLowerCase();
      if (h) return h;
    }
  } catch {
    // Kein `ancestorOrigins`, oder eine undurchsichtige Herkunft ("null").
  }
  let eingebettet = false;
  try {
    eingebettet = parent !== window;
    if (eingebettet) {
      const h = parent.location.hostname.toLowerCase();
      if (h) return h;
    }
  } catch {
    // Fremde Herkunft: `parent.location` ist gesperrt.
  }
  return eingebettet ? '' : null;
}

/**
 * Der Handschlag mit der Hauptwelt (Ablauf in `fingerabdruck-kanal.ts`).
 * Liefert das Geheimnis, das `reicheFingerabdruck` vor das `detail` setzt.
 *
 * In Safari gibt es keine Hauptwelt-Skripte (das Overlay laesst sie weg,
 * Katalog 32): Dort bliebe der Lauscher auf FRAGE fuer immer offen, und eine
 * Seite koennte an einer Antwort die Erweiterung erkennen. Deshalb dort kein
 * Handschlag.
 */
function handschlag(): string {
  const neu = geheimnisErzeugen();
  if (BROWSER === 'safari') return neu;
  try {
    const beiFrage = (): void => {
      try {
        document.dispatchEvent(new CustomEvent(HANDSCHLAG_ANTWORT, { detail: neu }));
      } catch {
        // Dann bleibt die Hauptwelt ohne Geheimnis und nimmt nichts an (sicher).
      }
    };
    const beiFertig = (): void => {
      document.removeEventListener(HANDSCHLAG_FRAGE, beiFrage, true);
      document.removeEventListener(HANDSCHLAG_FERTIG, beiFertig, true);
    };
    document.addEventListener(HANDSCHLAG_FRAGE, beiFrage, true);
    document.addEventListener(HANDSCHLAG_FERTIG, beiFertig, true);
    // Sofort einmal antworten: Lief die Hauptwelt zuerst, wartet sie schon.
    beiFrage();
  } catch {
    // Kein CustomEvent: Die Hauptwelt bleibt ohne Geheimnis, also an.
  }
  return neu;
}

function geheimnisErzeugen(): string {
  try {
    const c = crypto;
    if (typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
  } catch {
    // Sehr alte Umgebung: Math.random reicht fuer ein Geheimnis, das nur
    // bis zum ersten Seitenskript geheim sein muss.
    return `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * Der Kanal fuer das Rauschen, Gegenstueck in `src/inhalt/fingerabdruck.ts`.
 * Form des `detail` und Namen: `gemeinsam/fingerabdruck-kanal.ts`.
 */
function reicheFingerabdruck(f: KosmetikAntwort['fingerabdruck'] | undefined): void {
  // Ein alter Hintergrund nach einem Update kennt das Feld noch nicht: dann
  // nichts senden. Die Hauptwelt bleibt bei ihrer Vorgabe (an, gewuerfelt).
  if (!f || typeof f.an !== 'boolean') return;
  const detail = kodiere(geheimnis, { an: f.an, token: typeof f.token === 'string' ? f.token : null });
  try {
    document.dispatchEvent(new CustomEvent(EREIGNIS_FINGERABDRUCK, { detail, bubbles: false }));
  } catch {
    // Kein CustomEvent oder Dokument schon weg: die Hauptwelt behaelt ihre
    // Vorgabe, und die ist die sichere Seite (rauschen).
  }
}

/**
 * Gruppen zu hoechstens SELEKTOREN_JE_REGEL Selektoren: Ein einziger
 * ungueltiger Selektor macht seine ganze Regel wirkungslos, und in
 * Filterlisten stehen immer ein paar. Kleine Gruppen begrenzen den Schaden.
 */
function baueCss(selektoren: string[]): string {
  const teile: string[] = [];
  for (let i = 0; i < selektoren.length; i += SELEKTOREN_JE_REGEL) {
    const gruppe = selektoren
      .slice(i, i + SELEKTOREN_JE_REGEL)
      .filter((s) => typeof s === 'string' && s.length > 0 && s.indexOf('{') === -1 && s.indexOf('}') === -1);
    if (gruppe.length) teile.push(`${gruppe.join(',\n')}{display:none!important}`);
  }
  return teile.join('\n');
}

/**
 * Reicht den fertigen CSS-Text an die Huelle in der Hauptwelt weiter.
 *
 * OHNE DIESE ZEILE LAEUFT `schatten.ts` LEER: Es huellt `attachShadow` ein,
 * sammelt jede neue Root, wartet aber auf genau dieses Ereignis. Kommt es
 * nicht, bleibt jede GESCHLOSSENE Shadow Root unbehandelt, denn an die kommt
 * der MutationObserver hier nicht heran (`element.shadowRoot` ist dort
 * `null`).
 *
 * Weitergereicht werden nur die seitenSPEZIFISCHEN Selektoren. Die
 * generischen liegen als registriertes Stylesheet am Dokument und enden an
 * der Schattengrenze; sie hier mitzuschicken hiesse, 220 kB CSS je Rahmen
 * durch ein Ereignis zu tragen. Der Tausch ist bewusst: Werbung in
 * geschlossenen Roots kommt praktisch immer ueber eine seitenspezifische
 * Regel, nicht ueber eine generische.
 */
function reicheAnHauptwelt(css: string): void {
  try {
    document.dispatchEvent(new CustomEvent(EREIGNIS_KOSMETIK, { detail: css }));
  } catch {
    // Kein CustomEvent-Konstruktor (sehr alte Umgebung) oder Dokument schon
    // weg: dann bleibt es beim Licht-DOM. Nichts, was die Seite merkt.
  }
}

/**
 * Etwas tun, wenn der Browser gerade nichts Wichtigeres vorhat.
 *
 * `requestIdleCallback` gibt es in Chromium und Firefox, in Safari nicht;
 * dort tut es ein kurzer Zeitgeber. Beides ist richtig: Der erste Anstrich
 * der Seite darf nicht auf uns warten.
 */
function spaeter(was: () => void): void {
  const w = globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(was, { timeout: 2000 });
  else setTimeout(was, 300);
}

/**
 * Die generischen Selektoren der aktiven Listen als Text besorgen und an die
 * Hauptwelt reichen, die sie in jede Shadow Root legt.
 *
 * Der Absatz ueber `reicheAnHauptwelt` hat recht: 220 kB je Rahmen durch ein
 * Ereignis zu tragen ist teuer. Deshalb drei Grenzen: (1) nur im obersten
 * Rahmen, nicht in jedem eingebetteten; (2) erst, wenn der Browser Zeit hat
 * (`spaeter`); (3) der Text kommt aus dem eigenen Paket, kein Netz.
 *
 * GEMESSEN am 03.09.2026 in Chrome for Testing 131 an der Koederseite: Ein
 * `#AdBar` verschwand im Dokument, blieb aber in der offenen wie in der
 * geschlossenen Shadow Root sichtbar - denn `#AdBar` ist eine GENERISCHE
 * EasyList-Regel, und die erreichte den Schatten nie. Werbung in Web
 * Components ist damit nicht die Ausnahme, die der Absatz oben annimmt.
 */
async function generischeInDenSchatten(listen: string[]): Promise<void> {
  try {
    if (window.top !== window) return;
  } catch {
    return; // Cross-Origin-Rahmen: `window.top` wirft. Dann sind wir nicht oben.
  }

  // Den Text besorgt der Hintergrund: Er liest aus dem eigenen Paket. Ein
  // `fetch` von hier aus kam GEMESSEN nie zurueck, weil die Dateien bewusst
  // nicht `web_accessible` sind (sonst koennte jede Seite die Erweiterung
  // an ihnen erkennen).
  try {
    const antwort = (await api.runtime.sendMessage({ typ: 'kosmetik.generisch', listen })) as
      | { css?: string }
      | undefined;
    const css = antwort?.css;
    if (typeof css === 'string' && css.length > 0) reicheAnHauptwelt(css);
  } catch {
    // Hintergrund nicht erreichbar: dann eben keine Kosmetik im Schatten.
  }
}

function anbringen(css: string): void {
  const wurzel = document.documentElement;
  if (!wurzel) return;

  const style = document.createElement('style');
  style.setAttribute('data-adsilence', '');
  style.textContent = css;
  // Direkt ins Wurzelelement: `<head>` gibt es bei document_start noch nicht,
  // und ein Stylesheet wirkt an jeder Stelle des Baums.
  wurzel.appendChild(style);

  // Dasselbe Blatt einmal gebaut, dann in jeden Shadow Root uebernommen.
  let blatt: CSSStyleSheet | null = null;
  try {
    if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
      blatt = new CSSStyleSheet();
      blatt.replaceSync(css);
    }
  } catch {
    blatt = null;
  }

  const versorgt = new WeakSet<ShadowRoot>();

  function versorge(root: ShadowRoot): void {
    if (versorgt.has(root)) return;
    versorgt.add(root);
    try {
      if (blatt && 'adoptedStyleSheets' in root) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, blatt];
        return;
      }
    } catch {
      // Fremde Welt, kein Teilen moeglich: dann als Element.
    }
    const kopie = document.createElement('style');
    kopie.setAttribute('data-adsilence', '');
    kopie.textContent = css;
    root.appendChild(kopie);
  }

  function pruefe(el: Element): void {
    const root = el.shadowRoot;
    if (root) {
      versorge(root);
      // Was im Shadow Root spaeter dazukommt, kann selbst wieder Shadow Roots
      // haben (verschachtelte Komponenten).
      beobachte(root);
    }
  }

  function beobachte(ziel: Node): void {
    const beobachter = new MutationObserver((eintraege) => {
      for (const eintrag of eintraege) {
        for (const knoten of eintrag.addedNodes) {
          if (knoten.nodeType !== 1) continue;
          const el = knoten as Element;
          pruefe(el);
          // Ein eingefuegter Teilbaum wird EINMAL abgelaufen, nicht das
          // Dokument. Bei innerHTML mit Komponenten stehen deren Shadow Roots
          // in den Nachfahren, nicht im angehaengten Knoten selbst.
          if (el.firstElementChild) {
            const alle = el.getElementsByTagName('*');
            for (let i = 0; i < alle.length; i++) pruefe(alle[i]!);
          }
        }
      }
    });
    beobachter.observe(ziel, { childList: true, subtree: true });
  }

  beobachte(wurzel);
}

/**
 * Textregeln anwenden: `<selektor>` waehlen, Text pruefen, verstecken.
 *
 * Das ist der EINZIGE DOM-Lauf in dieser Datei, und der Kopf sagt zu Recht
 * "kein DOM-Scan". Der Widerspruch loest sich an einer Zahl: Textregeln sind
 * host-spezifisch, und GEMESSEN am 08.09.2026 tragen 798 von Millionen Hosts
 * ueberhaupt welche - im Schnitt 1,45 Regeln. Auf jeder anderen Seite ist die
 * Liste leer, diese Funktion wird nie gerufen, und es entsteht kein
 * Beobachter. Wo sie laeuft, kostet sie ein `querySelectorAll` je Regel.
 *
 * Warum ueberhaupt: Ein Overlay, das "Bitte deaktiviere deinen Werbeblocker"
 * sagt, traegt selten eine stabile Klasse - aber immer diesen Text. Das ist
 * der Grund, warum die Listen 1.520 solcher Regeln fuehren.
 *
 * `textContent` und nicht `innerText`: `innerText` erzwingt ein Layout, und
 * zwar bei JEDER Pruefung. Der Unterschied - `textContent` sieht auch
 * verborgenen Text - faellt hier nicht ins Gewicht, weil der Selektor davor
 * ohnehin eng ist.
 */
function starteTextlaeufer(regeln: { wahl: string; text: string }[]): void {
  const gepruefte = regeln
    .map((r) => {
      const roh = String(r.text ?? '');
      let treffer: (t: string) => boolean;
      if (roh.length > 2 && roh.startsWith('/') && roh.endsWith('/')) {
        try {
          const re = new RegExp(roh.slice(1, -1));
          treffer = (t) => re.test(t);
        } catch {
          return null; // unbrauchbarer Ausdruck: Regel weglassen, nicht raten
        }
      } else {
        treffer = (t) => t.includes(roh);
      }
      return { wahl: String(r.wahl ?? ''), treffer };
    })
    .filter((r): r is { wahl: string; treffer: (t: string) => boolean } => r !== null && r.wahl !== '');
  if (gepruefte.length === 0) return;

  const MERKER = 'adsilenceTextregel';
  const laufe = (): void => {
    for (const regel of gepruefte) {
      let knoten: NodeListOf<Element>;
      try {
        knoten = document.querySelectorAll(regel.wahl);
      } catch {
        continue; // Selektor, den dieser Browser nicht kennt
      }
      for (const el of knoten) {
        const h = el as HTMLElement;
        if (h.dataset && h.dataset[MERKER] === '1') continue;
        const text = el.textContent ?? '';
        if (text === '' || !regel.treffer(text)) continue;
        try {
          // `!important` gegen das Stylesheet der Seite, und ein Merker,
          // damit dasselbe Element nicht bei jeder Aenderung neu geprueft
          // wird.
          h.style.setProperty('display', 'none', 'important');
          if (h.dataset) h.dataset[MERKER] = '1';
        } catch {
          // Kein HTMLElement (SVG, MathML): dann eben nicht.
        }
      }
    }
  };

  laufe();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', laufe, { once: true, capture: true });
  }

  const Beobachter = (globalThis as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  if (typeof Beobachter !== 'function') return;
  let geplant = false;
  const beobachter = new Beobachter(() => {
    // Gebuendelt statt bei jeder Aenderung: Ein Overlay wird einmal
    // eingehaengt und danach hundertmal umgebaut.
    if (geplant) return;
    geplant = true;
    setTimeout(() => {
      geplant = false;
      laufe();
    }, 250);
  });
  const starte = (): void => {
    try {
      beobachter.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      // Noch kein Dokument: dann bleibt es beim ersten Lauf.
    }
  };
  if (document.documentElement) starte();
  else document.addEventListener('DOMContentLoaded', starte, { once: true, capture: true });
}
