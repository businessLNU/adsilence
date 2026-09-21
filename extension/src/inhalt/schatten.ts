/**
 * Inhaltsskript, HAUPTWELT (`"world": "MAIN"`), `document_start`, alle Rahmen.
 *
 * Aufgabe: Kosmetik in Shadow Roots bringen, an die sonst niemand herankommt.
 *
 * Ein Stylesheet des Dokuments endet an der Grenze eines Shadow Roots. Der
 * MutationObserver in `kosmetik.ts` findet OFFENE Roots und versorgt sie,
 * denn `element.shadowRoot` gibt sie preis. Bei `mode: 'closed'` gibt er `null`
 * zurueck, und die Root ist von aussen nicht mehr auffindbar. Genau dort
 * sitzt inzwischen ein guter Teil der Werbeeinbindungen: Ein Container mit
 * geschlossenem Schatten ist fuer jeden Blocker, der nur das Dokument kennt,
 * eine schwarze Kiste.
 *
 * Es gibt genau einen Zeitpunkt, an dem eine geschlossene Root fuer Dritte
 * sichtbar ist: wenn sie entsteht. `attachShadow` liefert sie ihrem Aufrufer
 * zurueck. Wer die Methode einhuellt, sieht jede Root, offen wie
 * geschlossen, ein einziges Mal und kann sie sich merken.
 *
 * DAS GEHT NUR IN DER HAUPTWELT. Ein Inhaltsskript in der isolierten Welt hat
 * ein eigenes `Element.prototype`; ein Patch dort betrifft die Seite nicht.
 * Deshalb dieses zweite, sehr kleine Skript, und deshalb ist sein einziger
 * Kontakt nach draussen ein Ereignis.
 *
 * WOHER DAS CSS KOMMT: Die Hauptwelt darf nicht mit dem Hintergrund
 * sprechen (kein `chrome.runtime`), und sie soll es auch nicht: Alles, was
 * hier steht, kann die Seite lesen. Den fertigen CSS-Text schickt das
 * ISOLIERTE Skript als `CustomEvent(EREIGNIS_KOSMETIK, { detail: css })`
 * an `document` (Name in `gemeinsam/fingerabdruck-kanal.ts`). Roots, die vor diesem Ereignis entstanden sind, warten in
 * einer Closure und bekommen das Blatt nachgereicht.
 *
 * KEINE GLOBALE AUF `window`. Kein Attribut, kein Element, kein Feldname.
 * Die Warteliste, das Stylesheet und die Merkliste leben in dieser Funktion
 * und nirgends sonst.
 *
 * ZUR SICHTBARKEIT DER HUELLE. Bis zum 05.09.2026 stand hier: Wer
 * `Element.prototype.attachShadow.toString()` liest, sieht keinen nativen
 * Rumpf, und ein Patch von `Function.prototype.toString` waere ein groesserer
 * Eingriff als der Nutzen wert. Die Abwaegung faellt seither anders aus,
 * denn den Patch gibt es ohnehin: `fingerabdruck.ts` braucht ihn, weil
 * FingerprintJS, CreepJS und die Bot-Erkennung hinter Turnstile jede Huelle
 * um `toDataURL` genau an dieser Zeile pruefen. Ein zweites, unmaskiertes
 * Loch daneben waere das Schlechtere: Es verriete dieselbe Erweiterung an
 * derselben Stelle. Deshalb registriert sich die Huelle hier bei
 * `tarnkappe.ts` (`tarne(huelle, echt)`), und `toString` liefert den Text
 * des Browsers. Jedes Buendel traegt eine eigene Kopie der Tarnkappe; die
 * beiden verketten sich, siehe dort.
 *
 * WAS DIE TARNKAPPE NICHT VERBIRGT, und was deshalb hier nicht behauptet
 * wird: Uebergibt die Seite ein Objekt mit einem Getter auf `init.mode`
 * (`el.attachShadow({ get mode() { s = new Error().stack; return 'open' } })`),
 * laeuft die Typumwandlung im nativen Aufruf, und der steht auf unserem
 * Rahmen; in `s` steht dann die Zeile
 * `at Element.attachShadow (chrome-extension://<id>/inhalt/schatten.js:…)`.
 * Die Store-ID ist fest, die Seite weiss damit „AdSilence". Kein Umbau
 * hilft dagegen; es steht als BEKANNT im Katalog (35-fingerabdruck.md).
 *
 * NICHTS DARF DIE SEITE BRECHEN. `attachShadow` ist eine Methode, auf die
 * jedes Web-Component-Framework baut. Faellt sie aus, ist die Seite kaputt,
 * und niemand wuerde die Erweiterung dafuer verantwortlich machen. Deshalb
 * liegt um jeden Schritt ein `try`, und die Huelle gibt die Root in JEDEM
 * Fall zurueck, auch wenn das Anhaengen scheitert.
 */

import { EREIGNIS_KOSMETIK } from '../gemeinsam/fingerabdruck-kanal.ts';
import { tarne } from './tarnkappe.ts';

/**
 * Hoechstens so viele Roots warten auf das CSS. Kommt das Ereignis nie (die
 * Seite steht auf der Ausnahmeliste, oder AdSilence ist aus), waechst die
 * Liste sonst mit jeder Komponente der Seite weiter und haelt Roots am Leben,
 * die der Browser laengst wegraeumen wollte. Wer mehr als 2000 Shadow Roots
 * baut, bevor eine Nachricht durch ist, bekommt keine Kosmetik in den letzten
 * davon; das ist der bessere Tausch.
 */
const WARTELISTE_MAX = 2000;

(function start() {
  try {
    if (typeof Element === 'undefined' || typeof document === 'undefined') return;

    // Den Deskriptor lesen, nicht die Eigenschaft: Am Ende wird NUR `value`
    // getauscht, alles andere bleibt, wie der Browser es angelegt hat.
    const desk = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow');
    const echt = desk?.value as typeof Element.prototype.attachShadow | undefined;
    if (!desk || typeof echt !== 'function') return;

    /** Der CSS-Text, sobald er da ist. Leer heisst: noch nichts zu tun. */
    let css = '';
    /** Ein einziges Blatt fuer alle Roots; `replaceSync` aendert sie alle auf einmal. */
    let blatt: CSSStyleSheet | null = null;
    /** Roots, die vor dem Ereignis entstanden sind. `null`, sobald bedient. */
    let warteliste: ShadowRoot[] | null = [];
    /** Verhindert ein zweites Blatt in derselben Root. Schwach, damit nichts festgehalten wird. */
    const versorgt = new WeakSet<ShadowRoot>();

    function baueBlatt(): void {
      try {
        if (typeof CSSStyleSheet !== 'function' || !('replaceSync' in CSSStyleSheet.prototype)) return;
        if (!blatt) blatt = new CSSStyleSheet();
        blatt.replaceSync(css);
      } catch {
        // Aeltere Safari-Fassungen kennen keine baubaren Stylesheets. Dann
        // bekommt jede Root ihr eigenes `<style>`; das kostet Speicher, wirkt
        // aber gleich.
        blatt = null;
      }
    }

    function versorge(root: ShadowRoot): void {
      if (!root || versorgt.has(root)) return;
      try {
        if (blatt && 'adoptedStyleSheets' in root) {
          const vorhanden = root.adoptedStyleSheets;
          if (!vorhanden.includes(blatt)) root.adoptedStyleSheets = [...vorhanden, blatt];
          versorgt.add(root);
          return;
        }
      } catch {
        // Manche Roots gehoeren einem anderen Dokument; ein Blatt laesst sich
        // dann nicht teilen. Weiter mit dem Rueckfall.
      }
      try {
        const style = document.createElement('style');
        style.textContent = css;
        root.appendChild(style);
        versorgt.add(root);
      } catch {
        // Root schon wieder weg oder gesperrt: nichts weiter zu tun.
      }
    }

    function merke(root: ShadowRoot): void {
      if (css) {
        versorge(root);
        return;
      }
      if (warteliste && warteliste.length < WARTELISTE_MAX) warteliste.push(root);
    }

    function beiCss(text: string): void {
      if (typeof text !== 'string' || text.length === 0) return;
      // ANHAENGEN, nicht ersetzen: Das isolierte Skript schickt zwei Ereignisse,
      // erst die seitenspezifischen Regeln (sofort), dann die generischen
      // (wenn der Browser Zeit hat). Ein `css = text` liesse das zweite das
      // erste ueberschreiben, und die spezifischen Regeln waeren im Schatten
      // wieder weg. `replaceSync` auf dem geteilten Blatt traegt die neue
      // Fassung in jede Root, die es schon hat.
      css = css ? `${css}\n${text}` : text;
      baueBlatt();
      // `adoptedStyleSheets` traegt das Blatt, nicht seinen Inhalt: Roots, die
      // es schon haben, sehen die neue Fassung von selbst. Nachzureichen sind
      // nur die Wartenden.
      const warten = warteliste;
      warteliste = null;
      if (warten) for (const root of warten) versorge(root);
    }

    // Der Lauscher steht, bevor irgendetwas anderes passiert. Die Reihenfolge
    // zwischen isolierter und Hauptwelt bei `document_start` ist nicht
    // zugesichert, aber das isolierte Skript fragt erst den Hintergrund; sein
    // Ereignis kommt fruehestens einen Tick spaeter.
    document.addEventListener(
      EREIGNIS_KOSMETIK,
      (e) => {
        try {
          beiCss((e as CustomEvent<string>).detail);
        } catch {
          // Ein fremdes Ereignis mit demselben Namen: ignorieren.
        }
      },
      // `capture`, damit ein `stopPropagation` der Seite nichts abschneidet.
      true,
    );

    // Methoden-Kurzschreibweise, keine `function`-Deklaration: So hat die
    // Huelle kein `prototype` und laesst kein `new` zu, wie die native
    // Methode. Gemessen in Chrome 148: Eine Deklaration traegt `prototype`,
    // und CreepJS prueft genau das.
    const huelle = {
      attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
        // Der echte Aufruf zuerst und ausserhalb des `try`: Die Seite sieht
        // die native Ausnahme (NotSupportedError bei einem `<div>`, der schon
        // eine Root hat), nicht eine aus der Huelle.
        const root = echt.call(this, init);
        try {
          merke(root);
        } catch {
          // Buchhaltung gescheitert; die Seite bekommt trotzdem ihre Root.
        }
        return root;
      },
    }.attachShadow;

    // Name und Stelligkeit angleichen, `toString` tarnen: Bibliotheken
    // pruefen alle drei, wenn sie selbst Methoden einhuellen wollen.
    tarne(huelle, echt);

    // NUR `value` tauschen. Kein getipptes `enumerable`: Native Methoden
    // sind AUFZAEHLBAR (`Object.keys(Element.prototype)` enthaelt
    // `attachShadow`); ein `enumerable: false` stand hier bis zum 05.09.2026
    // mit dem Kommentar „wie der Browser sie angelegt hat", und das war
    // falsch.
    desk.value = huelle;
    Object.defineProperty(Element.prototype, 'attachShadow', desk);
  } catch {
    // Was hier scheitert, scheitert leise. Eine Seite ohne Kosmetik in
    // geschlossenen Roots ist ein Schoenheitsfehler; eine Seite mit kaputtem
    // `attachShadow` ist unbenutzbar.
  }
})();
