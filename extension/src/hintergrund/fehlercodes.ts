/**
 * Fehlercodes des Backends → Zustaende der Erweiterung (vertrag.md 6).
 * Reine Zuordnung; der Speicher wird in konto.ts angefasst.
 */

/** Die Sitzung ist weg. Token loeschen, Nutzer muss neu verbinden. */
export const CODES_TRENNEN = new Set([
  'TOKEN_REUSE_DETECTED',
  'INVALID_REFRESH_TOKEN',
  'REFRESH_TOKEN_EXPIRED',
  'TOKEN_STALE',
  'USER_GONE',
]);

/** Der Dienst ist gerade nicht da; letzter Stand bleibt, spaeter erneut. */
export const CODES_SPAETER = new Set(['SITE_LOCKED', 'MAINTENANCE', 'RATE_LIMITED']);

export type Folge = 'trennen' | 'gesperrt' | 'spaeter' | 'fehler';

/**
 * `status` deckt die Faelle ohne stabilen Code ab: 5xx und 429 (die Bremse
 * antwortet nicht immer mit einem Rumpf) heissen „spaeter", ein Netzfehler
 * kommt als status 0.
 */
export function folgeFuer(code: string | null, status: number): Folge {
  if (code && CODES_TRENNEN.has(code)) return 'trennen';
  if (code === 'ACCOUNT_BLOCKED') return 'gesperrt';
  if (code && CODES_SPAETER.has(code)) return 'spaeter';
  if (status === 0 || status === 429 || status >= 500) return 'spaeter';
  return 'fehler';
}

/**
 * Verbindungscode in die Form XXXX-XXXX: Grossbuchstaben, Bindestrich
 * optional, Leerzeichen egal. Was danach nicht acht Zeichen aus A-Z2-9 hat,
 * ist kein Code; dann kommt null zurueck.
 */
export function normalisiereCode(eingabe: string): string | null {
  const roh = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z2-9]{8}$/.test(roh)) return null;
  return `${roh.slice(0, 4)}-${roh.slice(4)}`;
}
