import { format, messages as m } from '../i18n';
import { daysBetween } from './dates';

/** „heute“, „morgen“, „in 4 Tagen“, „gestern“, „vor 3 Tagen“: der Abstand eines Datums zu heute in Worten. */
export function relativeDay(date: string, today: string): string {
  const days = daysBetween(today, date);
  const e = m.planning.exams;
  if (days === 0) return e.today;
  if (days === 1) return e.tomorrow;
  if (days === -1) return e.yesterday;
  return days > 0 ? format(e.inDays, { count: days }) : format(e.daysAgo, { count: -days });
}
