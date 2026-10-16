import { useCallback, useEffect, useRef, useState } from 'react';

/** Zustand des Kopierens: still, kurz „kopiert“ oder „nicht möglich“. */
export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Kopiert Text in die Zwischenablage und hält das Ergebnis fest: kurz „kopiert“, bei einer
 * abgelehnten oder fehlenden Zwischenablage (z. B. ohne HTTPS) „nicht möglich“ statt stillen
 * Verschluckens. Der Aufrufer zeigt den Zustand in einer eigenen, kleinen aria-live-Region
 * (eine je Kopieren-Kontext, nie am ganzen Container) und meldet so auch Screenreadern.
 */
export function useCopy(): { copyState: CopyState; copy: (text: string) => Promise<void> } {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopyState('failed');
      return;
    }
    setCopyState('copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('idle'), 1800);
  }, []);

  return { copyState, copy };
}
