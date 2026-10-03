import { ApiError } from '../api/client';
import { format, formatWait, messages as m } from '../i18n';

/** Allgemeine Fehlertexte, die in jedem Formular gleich lauten. */
export function commonErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'network') return m.errors.network;
  return m.errors.unknown;
}

export function rateLimitMessage(template: string, error: ApiError): string {
  return format(template, { wait: formatWait(error.details.retryAfterSeconds ?? 0) });
}
