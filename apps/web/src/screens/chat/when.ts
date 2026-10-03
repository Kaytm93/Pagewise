import { format, messages as m } from '../../i18n';

const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayLong = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dayShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** „heute, 14:05“, „gestern, 09:30“, sonst das Datum („3. Okt.“, im Vorjahr mit Jahr). */
export function formatWhen(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  const time = clock.format(date);
  if (days === 0) return format(m.time.today, { time });
  if (days === 1) return format(m.time.yesterday, { time });
  return (date.getFullYear() === today.getFullYear() ? dayShort : dayLong).format(date);
}
