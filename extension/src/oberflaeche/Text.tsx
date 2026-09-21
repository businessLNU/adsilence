/**
 * Ein Satz aus `t()`, in dem Platzhalter zu Elementen werden, etwa der
 * Zustimmungssatz mit drei Links. Die Textstuecke bleiben Text, jedes
 * `{name}` wird durch `teile[name]` ersetzt.
 */
import type { ReactNode } from 'react';
import { tTeile } from './i18n.ts';

export function TextMitTeilen({ schluessel, teile }: { schluessel: string; teile: Record<string, ReactNode> }) {
  return (
    <>
      {tTeile(schluessel).map((teil, i) =>
        typeof teil === 'string' ? <span key={i}>{teil}</span> : <span key={i}>{teile[teil.platzhalter] ?? `{${teil.platzhalter}}`}</span>,
      )}
    </>
  );
}
