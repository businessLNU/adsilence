/**
 * Kosmetische Regeln (`##`, `#@#`) → Selektorlisten für das Stylesheet.
 *
 * Warum die Grammatik so eng ist: Die generischen Selektoren landen zu je
 * 500 in EINER CSS-Regel (`a, b, c { display: none !important }`). Ein
 * einziger ungültiger Selektor darin, und der Browser verwirft die ganze
 * Regel, also 500 Selektoren auf einmal, ohne Meldung. Deshalb kommt hier nur
 * durch, was sicher gültiges CSS ist. Lieber zehn exotische Selektoren
 * verlieren als fünfhundert gewöhnliche.
 *
 * Nicht umgesetzt (prozedural, braucht JavaScript): `:-abp-...`, `:upward`,
 * `:has-text`, `:matches-css`, `:xpath`, `:remove`, `:style`, `:watch-attr`
 * und alles andere, was nicht in `PSEUDOKLASSEN` steht.
 */
import type { Regel } from './abp.ts';
import { zaehle } from './gruende.ts';

export type Kosmetik = {
  /** Auf jeder Seite verstecken. */
  generisch: string[];
  /** Nur auf diesem Host (und seinen Subdomains). */
  spezifisch: Record<string, string[]>;
  /** Auf diesem Host NICHT verstecken, auch wenn generisch oder spezifisch gefordert. */
  ausnahmen: Record<string, string[]>;
};

/** Pseudoklassen, die jeder Zielbrowser (Chrome 121, Firefox 128, Safari 17) kennt. */
const PSEUDOKLASSEN = new Set([
  'not',
  'has',
  'is',
  'where',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
  'empty',
  'root',
]);

const ERLAUBT_AUSSEN = /^[A-Za-z0-9_\-.#[\]="':*~^$|>+ ,()\\\u00a0-\uffff]$/;
const IDENT_ANFANG = /^-?[A-Za-z_\\\u00a0-\uffff]/;

/**
 * Ist der Selektor sicher gültiges CSS im Rahmen unserer Grammatik?
 *
 * Ein kleiner Zustandsautomat statt eines Regex: Zeichenketten in Anführungs-
 * zeichen dürfen fast alles enthalten (`[href*="/ads/?x"]`), draussen gilt
 * der enge Zeichensatz. Klammern und Anführungszeichen müssen schliessen,
 * Pseudoklassen stehen auf der Liste, Klassen- und ID-Namen beginnen nicht
 * mit einer Ziffer.
 *
 * CSS-Escapes (`\[`, `\:`, `\5f `) sind erlaubt: Tailwind-Klassen wie
 * `.h-\[250px\]` stehen zu Hunderten in den Listen, und ein Escape kann
 * die Regel nicht sprengen. Nur ein `\` am Ende ist verboten: Es würde das
 * Zeilenende der Gruppe escapen und die ganze Gruppe ungültig machen.
 * Zeichen ausserhalb ASCII sind in Bezeichnern und Zeichenketten gültiges
 * CSS (`.сookie`, `[aria-label="Erfahre mehr über ..."]`); Steuerzeichen nicht.
 */
/**
 * Warum ein Selektor nicht durchkam — die eine Stelle, die das entscheidet.
 *
 * Zwei verschiedene Aussagen, und sie duerfen nicht in einen Topf: Ein
 * `##`-Selektor, der scheitert, ist KAPUTT. Ein `#?#`-Selektor, der
 * scheitert, traegt einen Operator, den CSS nicht kann (`:has-text(`,
 * `:-abp-contains(`, `:-abp-properties(`) — daran ist nichts kaputt, es fehlt
 * uns nur der DOM-Laeufer dafuer. Wer die eine Zahl senken will, sucht einen
 * Fehler; wer die andere senken will, baut einen Operator nach.
 *
 * Gefragt wird von zwei Seiten: vom Bau (`zuKosmetik`) und vom Textfeld der
 * Optionsseite (`eigene.ts`). Zweimal dieselbe Bedingung waere zweimal
 * dieselbe Entscheidung — und irgendwann zwei verschiedene.
 */
export function grundFuerSelektor(regel: { prozedural: boolean }): 'erweiterteKosmetik' | 'selektorUngueltig' {
  return regel.prozedural ? 'erweiterteKosmetik' : 'selektorUngueltig';
}

export function selektorGueltig(selektor: string): boolean {
  if (selektor.length === 0 || selektor.length > 1000) return false;
  if (/[\x00-\x1f\x7f-\x9f]/.test(selektor)) return false;
  if (/(^|[^\\])(\\\\)*\\$/.test(selektor)) return false;

  let anfuehrung: string | null = null;
  let runde = 0;
  let eckige = 0;
  let letztesZeichen = '';

  for (let i = 0; i < selektor.length; i += 1) {
    const z = selektor[i];

    if (z === '\\') {
      // Escape: das nächste Zeichen ist Text, egal was es ist.
      i += 1;
      letztesZeichen = 'a';
      continue;
    }

    if (anfuehrung !== null) {
      if (z === anfuehrung) anfuehrung = null;
      letztesZeichen = z;
      continue;
    }

    if (!ERLAUBT_AUSSEN.test(z)) return false;

    if (z === '"' || z === "'") {
      anfuehrung = z;
    } else if (z === '(') {
      runde += 1;
      if (selektor[i + 1] === ')') return false;
    } else if (z === ')') {
      runde -= 1;
      if (runde < 0) return false;
    } else if (z === '[') {
      eckige += 1;
      if (eckige > 1) return false;
    } else if (z === ']') {
      eckige -= 1;
      if (eckige < 0) return false;
    } else if ((z === '.' || z === '#') && eckige === 0) {
      // `.5star` und `#1` sind ungültig; `.ad`, `.-ad`, `#_x` sind gültig.
      const rest = selektor.slice(i + 1, i + 3);
      if (!IDENT_ANFANG.test(rest)) return false;
    } else if (z === ':' && eckige === 0) {
      if (selektor[i + 1] === ':') return false; // Pseudoelemente
      const treffer = /^[a-zA-Z-]+/.exec(selektor.slice(i + 1));
      if (!treffer) return false;
      if (!PSEUDOKLASSEN.has(treffer[0].toLowerCase())) return false;
    } else if (z === ',' && runde === 0 && letztesZeichen === ',') {
      return false;
    }

    letztesZeichen = z;
  }

  if (anfuehrung !== null || runde !== 0 || eckige !== 0) return false;
  const geputzt = selektor.trim();
  if (geputzt.startsWith(',') || geputzt.endsWith(',')) return false;
  return true;
}

/** Hostname für den Abgleich mit `location.hostname`: ASCII, klein, kein Platzhalter. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function hostGueltig(host: string): boolean {
  return HOST.test(host);
}

function haenge(karte: Map<string, Set<string>>, host: string, selektor: string): void {
  let menge = karte.get(host);
  if (!menge) {
    menge = new Set();
    karte.set(host, menge);
  }
  menge.add(selektor);
}

function alsRecord(karte: Map<string, Set<string>>): Record<string, string[]> {
  const ergebnis: Record<string, string[]> = {};
  for (const host of Array.from(karte.keys()).sort()) {
    ergebnis[host] = Array.from(karte.get(host)!);
  }
  return ergebnis;
}

/**
 * Kosmetikregeln einer Liste bündeln. `verworfen` (optional) zählt mit, was
 * nicht durchkam, nach Grund.
 *
 * Semantik:
 *   `##a`              → generisch
 *   `~x.com##a`        → generisch + Ausnahme auf x.com
 *   `x.com##a`         → spezifisch auf x.com
 *   `x.com,~s.x.com##a`→ spezifisch x.com + Ausnahme s.x.com
 *   `x.com#@#a`        → Ausnahme auf x.com
 *   `#@#a`             → streicht `a` aus generisch
 */
export function zuKosmetik(regeln: Regel[], verworfen: Record<string, number> = {}): Kosmetik {
  const generisch = new Set<string>();
  const globalAusnahmen = new Set<string>();
  const spezifisch = new Map<string, Set<string>>();
  const ausnahmen = new Map<string, Set<string>>();

  for (const regel of regeln) {
    if (regel.typ !== 'kosmetik') continue;
    if (!selektorGueltig(regel.selektor)) {
      /*
       * Zwei verschiedene Aussagen, und sie duerfen nicht in einen Topf:
       * Ein `##`-Selektor, der hier scheitert, ist KAPUTT. Ein `#?#`-Selektor,
       * der scheitert, trägt einen Operator, den CSS nicht kann
       * (`:has-text(`, `:-abp-contains(`, `:-abp-properties(`) -- daran ist
       * nichts kaputt, es fehlt uns nur der DOM-Laeufer dafuer. Wer die eine
       * Zahl senken will, tut etwas anderes als wer die andere senken will.
       */
      zaehle(verworfen, { grund: grundFuerSelektor(regel) });
      continue;
    }
    const domains = regel.domains.filter(hostGueltig);
    const ausgeschlossene = regel.ausgeschlosseneDomains;
    // Eine unbrauchbare Domain in der Negation (`~example.*`) hiesse: die
    // Ausnahme geht verloren und der Selektor greift, wo er nicht sollte.
    // Also die ganze Regel weg. Bei positiven Domains reicht es, den
    // Eintrag zu übergehen: weniger verstecken ist die sichere Richtung.
    if (!ausgeschlossene.every(hostGueltig)) {
      zaehle(verworfen, { grund: 'domainUngueltig' });
      continue;
    }
    if (regel.domains.length > 0 && domains.length === 0) {
      zaehle(verworfen, { grund: 'domainUngueltig' });
      continue;
    }

    if (regel.ausnahme) {
      if (domains.length === 0) globalAusnahmen.add(regel.selektor);
      for (const host of domains) haenge(ausnahmen, host, regel.selektor);
      continue;
    }

    if (domains.length === 0) generisch.add(regel.selektor);
    for (const host of domains) haenge(spezifisch, host, regel.selektor);
    for (const host of ausgeschlossene) haenge(ausnahmen, host, regel.selektor);
  }

  for (const selektor of globalAusnahmen) generisch.delete(selektor);

  return {
    generisch: Array.from(generisch),
    spezifisch: alsRecord(spezifisch),
    ausnahmen: alsRecord(ausnahmen),
  };
}

/**
 * Selektoren als Stylesheet: Gruppen zu höchstens `jeGruppe` Selektoren je
 * Regel. Kleiner als eine Regel je Selektor (Parser-Zeit), kleiner als eine
 * einzige Regel (ein Fehler kostet nur eine Gruppe).
 */
export function alsStylesheet(selektoren: string[], jeGruppe = 500): string {
  const teile: string[] = [];
  for (let i = 0; i < selektoren.length; i += jeGruppe) {
    teile.push(`${selektoren.slice(i, i + jeGruppe).join(',\n')}{display:none!important}`);
  }
  return teile.join('\n');
}
