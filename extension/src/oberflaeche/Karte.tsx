/**
 * Die Karte: Flaeche eine Stufe heller als der Grund, 12 px Radius, ein
 * haarfeiner Rand ueber den Schatten. Nur dort, wo eine Gruppe wirklich
 * fuer sich steht (Site, Premium); Zeilen dazwischen brauchen keine.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export function Karte({ eng, className, children, ...rest }: HTMLAttributes<HTMLElement> & { eng?: boolean; children: ReactNode }) {
  return (
    <section className={['karte', eng ? 'karte--eng' : '', className ?? ''].join(' ').trim()} {...rest}>
      {children}
    </section>
  );
}
