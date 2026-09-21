/**
 * Eine Hinweiszeile: Fehler (rot), Warnung, Erfolg, neutral. Fehler tragen
 * `role="alert"`, damit ein Screenreader sie sofort liest.
 *
 * `fehlerText(code)` uebersetzt einen Fehlercode aus dem Hintergrund in den
 * Satz, den ein Mensch lesen soll. Unbekannte Codes bekommen den
 * allgemeinen Satz und den Code in Klammern, damit eine Meldung an den
 * Support etwas Greifbares enthaelt.
 */
import type { ReactNode } from 'react';
import { t } from './i18n.ts';

export function Hinweis({ art = 'neutral', children }: { art?: 'fehler' | 'warn' | 'gut' | 'neutral'; children: ReactNode }) {
  return (
    <div className={`hinweis hinweis--${art}`} role={art === 'fehler' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

const BEKANNT: Record<string, string> = {
  HINTERGRUND_FEHLT: 'gemeinsam.fehler.hintergrund',
  LIZENZ_ERFORDERLICH: 'gemeinsam.fehler.lizenz',
  NETZ: 'gemeinsam.fehler.netz',
  NETWORK: 'gemeinsam.fehler.netz',
  OFFLINE: 'gemeinsam.fehler.netz',
  SITE_LOCKED: 'gemeinsam.fehler.dienst',
  MAINTENANCE: 'gemeinsam.fehler.dienst',
  RATE_LIMITED: 'gemeinsam.fehler.dienst',
  SERVER: 'gemeinsam.fehler.dienst',
  ACCOUNT_BLOCKED: 'gemeinsam.gesperrt',
  TOKEN_REUSE_DETECTED: 'gemeinsam.neuVerbinden',
  INVALID_REFRESH_TOKEN: 'gemeinsam.neuVerbinden',
  REFRESH_TOKEN_EXPIRED: 'gemeinsam.neuVerbinden',
  TOKEN_STALE: 'gemeinsam.neuVerbinden',
  USER_GONE: 'gemeinsam.neuVerbinden',
};

export function fehlerText(code: string | undefined): string {
  if (!code) return t('gemeinsam.fehler.allgemein');
  const schluessel = BEKANNT[code];
  if (schluessel) return t(schluessel);
  return `${t('gemeinsam.fehler.allgemein')} ${t('gemeinsam.fehler.code', { code })}`;
}
