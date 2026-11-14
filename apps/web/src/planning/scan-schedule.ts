import type { ScanPeriodSchedule, ScanPeriodTime } from '../api/types';

const MINUTES_PER_DAY = 24 * 60;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function toClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Uhrzeiten aller Stunden aus der Regel, wie sie der Server rechnet: Stunde um Stunde ab dem
 * Unterrichtsbeginn, dazwischen die normale Pause oder, nach den eingetragenen Stunden, die lange.
 * So sieht man jede Änderung sofort für die ganze Woche.
 */
export function periodsFromSchedule(schedule: ScanPeriodSchedule): ScanPeriodTime[] {
  if (!/^\d{2}:\d{2}$/.test(schedule.start)) return [];
  const pauses = new Map(schedule.breaks.map((entry) => [entry.after, entry.minutes]));
  const rows: ScanPeriodTime[] = [];
  let cursor = toMinutes(schedule.start);
  for (let period = 1; period <= schedule.count; period += 1) {
    const end = cursor + schedule.lessonMinutes;
    if (schedule.lessonMinutes <= 0 || end >= MINUTES_PER_DAY) break;
    rows.push({ period, startTime: toClock(cursor), endTime: toClock(end) });
    cursor = end + (pauses.get(period) ?? schedule.gapMinutes);
  }
  return rows;
}

/** Neue Zeiten für Stunden mit Nummer, z. B. nachdem die Stundentafel geändert wurde. */
export function retime<
  T extends {
    period: number | null;
    periodEnd?: number | null;
    startTime: string;
    endTime: string;
  },
>(entries: readonly T[], periods: readonly ScanPeriodTime[]): T[] {
  const table = new Map(periods.map((row) => [row.period, row]));
  return entries.map((entry) => {
    if (entry.period === null) return entry;
    const first = table.get(entry.period);
    const last = table.get(entry.periodEnd ?? entry.period);
    return first && last ? { ...entry, startTime: first.startTime, endTime: last.endTime } : entry;
  });
}
