/**
 * Die Symbole der Oberflaeche als Strichzeichnungen (24er Raster, 1.75 px
 * Strich, runde Enden), damit sie neben der Systemschrift stehen koennen.
 * Kein Symbolpaket: `package.json` gehoert B1, und eine Handvoll Pfade
 * rechtfertigt keine Abhaengigkeit. Alle `aria-hidden`; die Bedeutung traegt
 * der Knopf, in dem sie stehen.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { groesse?: number };

function Rahmen({ groesse = 18, children, ...rest }: P) {
  return (
    <svg
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function Zahnrad(p: P) {
  return (
    <Rahmen {...p}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Rahmen>
  );
}

export function Schloss(p: P) {
  return (
    <Rahmen {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Rahmen>
  );
}

export function Haken(p: P) {
  return (
    <Rahmen {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Rahmen>
  );
}

export function Kreuz(p: P) {
  return (
    <Rahmen {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Rahmen>
  );
}

/**
 * Das „i" hinter einem Namen: Kreis, Strich, Punkt.
 *
 * Der Punkt ist ein GEFUELLTER Kreis und kein Pfad der Laenge null. Letzterer
 * (`M12 8h0`) ist der uebliche Kniff und stuetzt sich darauf, dass der
 * Renderer aus `strokeLinecap: round` einen Punkt macht - das tun nicht alle
 * gleich, und ein „i" ohne Punkt ist ein Ausrufezeichen verkehrt herum.
 */
export function Info(p: P) {
  return (
    <Rahmen {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.5v5" />
      <circle cx="12" cy="7.75" r="1.1" fill="currentColor" stroke="none" />
    </Rahmen>
  );
}

export function Extern(p: P) {
  return (
    <Rahmen {...p}>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
    </Rahmen>
  );
}

/**
 * Das Zeichen von AdSilence: ein abgerundetes Quadrat im Akzent mit einem
 * durchgestrichenen Schallzeichen. Wird nur gezeigt, wenn das PNG aus
 * `icons/` nicht erreichbar ist (Vorschau ohne Paket).
 */
export function Marke({ groesse = 24 }: { groesse?: number }) {
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="6" fill="var(--marke-von)" />
      <path
        d="M7 10h2.5L13 7v10l-3.5-3H7z"
        fill="var(--marke-akzent-schrift)"
      />
      <path d="M15.5 9.5 19 13m0-3.5-3.5 3.5" stroke="var(--marke-akzent-schrift)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
