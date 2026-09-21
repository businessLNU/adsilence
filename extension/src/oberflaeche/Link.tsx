/**
 * Ein Link, der im Popup einen Tab oeffnet. `target="_blank"` reicht dort
 * nicht ueberall: Safari oeffnet aus einem Popup heraus nichts, Chrome
 * schliesst das Popup und oeffnet, Firefox je nach Version. Deshalb geht
 * jeder Klick ueber `oeffneTab()`; `href` bleibt fuer Statusleiste,
 * Tastatur und Screenreader stehen.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { oeffneTab } from './laufzeit.ts';

export function Link({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        void oeffneTab(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
