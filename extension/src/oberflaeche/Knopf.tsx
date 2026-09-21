/**
 * Der Knopf. Vier Arten, eine Absicht je Knopf, Text hoechstens drei Woerter
 * (kommt aus `t()`, der Aufrufer traegt ihn herein).
 *
 * `beschaeftigt` schaltet ab und senkt die Deckkraft, ohne Spinner: Bei
 * Wartezeiten unter einer Sekunde ist ein Spinner nur Unruhe.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Art = 'primaer' | 'sekundaer' | 'leise' | 'gefahr';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  art?: Art;
  klein?: boolean;
  breit?: boolean;
  beschaeftigt?: boolean;
  children: ReactNode;
};

export function Knopf({ art = 'sekundaer', klein, breit, beschaeftigt, className, disabled, type, children, ...rest }: Props) {
  const klassen = ['knopf', 'drueckbar', `knopf--${art}`];
  if (klein) klassen.push('knopf--klein');
  if (breit) klassen.push('knopf--breit');
  if (className) klassen.push(className);
  return (
    <button
      type={type ?? 'button'}
      className={klassen.join(' ')}
      disabled={disabled || beschaeftigt}
      aria-busy={beschaeftigt ? 'true' : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Ein quadratischer Knopf nur mit Symbol; `beschriftung` ist sein Name. */
export function SymbolKnopf({ beschriftung, className, children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { beschriftung: string; children: ReactNode }) {
  return (
    <button type="button" className={['knopf', 'drueckbar', 'knopf--symbol', className].filter(Boolean).join(' ')} aria-label={beschriftung} title={beschriftung} {...rest}>
      {children}
    </button>
  );
}
