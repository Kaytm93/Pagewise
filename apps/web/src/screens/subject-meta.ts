import type { Subject } from '../api/types';
import { format, messages as m } from '../i18n';

/** „Lehrkraft · 3 Std. pro Woche“, nur was angegeben ist. */
export function subjectMeta(subject: Pick<Subject, 'teacher' | 'hoursPerWeek'>): string {
  const parts: string[] = [];
  if (subject.teacher) parts.push(subject.teacher);
  if (subject.hoursPerWeek) {
    parts.push(format(m.common.hoursPerWeek, { count: subject.hoursPerWeek }));
  }
  return parts.join(' · ');
}

export function groupCount(count: number): string {
  return count === 1 ? m.home.groupsOne : format(m.home.groupsMany, { count });
}
