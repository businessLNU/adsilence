/**
 * Platzhalter in der Form des Inhalts, der gleich kommt. Kein Spinner: Ein
 * Skeleton sagt „so wird es aussehen", ein Kreis sagt nur „warte".
 * Pulst nur in der Deckkraft; unter reduced-motion steht er still.
 */
import type { CSSProperties } from 'react';

export function Skeleton({ breite = '100%', hoehe = 14, rund, style }: { breite?: number | string; hoehe?: number | string; rund?: boolean; style?: CSSProperties }) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: breite, height: hoehe, borderRadius: rund ? '999px' : undefined, ...style }}
    />
  );
}
