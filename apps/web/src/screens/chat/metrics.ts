import { format, messages as m } from '../../i18n';

const speedFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const costFormat = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
});

/** Kosten in US-Dollar mit zwei gültigen Stellen (0,00115 wird 0,0012 $). */
export function formatCost(usd: number): string {
  return costFormat.format(usd);
}

/**
 * Kleine Zeile unter einer fertigen Antwort: Tokengeschwindigkeit und Kosten, soweit bekannt. `null`, wenn es
 * nichts zu zeigen gibt (Freie Modelle, Pläne und lokale Anbieter haben keine Kosten).
 */
export function metricsLine(message: {
  tokensPerSecond: number | null;
  costUsd: number | null;
}): string | null {
  const parts: string[] = [];
  if (message.tokensPerSecond !== null) {
    parts.push(format(m.chat.speed, { speed: speedFormat.format(message.tokensPerSecond) }));
  }
  if (message.costUsd !== null) {
    parts.push(format(m.chat.cost, { cost: formatCost(message.costUsd) }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
