import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate, pathFor, type Route } from '../router';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: Route;
}

/** Interner Link ohne Neuladen. Mit Strg/Cmd-Klick oder mittlerer Maustaste öffnet er wie gewohnt einen neuen Tab. */
export function Link({ to, onClick, children, ...rest }: Props) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={pathFor(to)} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
