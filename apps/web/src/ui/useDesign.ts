import { useSyncExternalStore } from 'react';
import { DESIGN_EVENT, DESIGNS, type Design } from './design';

function subscribe(callback: () => void): () => void {
  window.addEventListener(DESIGN_EVENT, callback);
  return () => window.removeEventListener(DESIGN_EVENT, callback);
}

function snapshot(): Design | null {
  const value = document.documentElement.getAttribute('data-design');
  return DESIGNS.find((design) => design === value) ?? null;
}

/**
 * Die gesetzte Designrichtung (Attribut `data-design` am <html>), `null` solange keine gesetzt ist (nur in
 * Tests; in der App setzt `public/boot.js` sie vor dem ersten Anstrich). Für Bausteine, die es nur in einer
 * Richtung gibt, etwa die Tageslinie in „Raum“.
 */
export function useDesign(): Design | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
