import { format, messages as m } from './i18n';

export interface QuitStatus {
  activeChats: number;
  sessions: number;
}

/** Fragt vor „Pagewise beenden“ nach, wenn Antworten laufen oder Anmeldungen bestehen (nicht „Geräte“: eine installierte App hat eigene Cookies). */
export function describeQuit(status: QuitStatus | null): { needsConfirm: boolean; detail: string } {
  if (!status) return { needsConfirm: false, detail: m.dialogs.quitDetailBase };
  const lines: string[] = [];
  if (status.activeChats > 0) {
    lines.push(
      status.activeChats === 1
        ? m.dialogs.quitRunningOne
        : format(m.dialogs.quitRunningMany, { count: status.activeChats }),
    );
  }
  if (status.sessions > 0) lines.push(format(m.dialogs.quitSessions, { count: status.sessions }));
  return {
    needsConfirm: lines.length > 0,
    detail: [...lines, m.dialogs.quitDetailBase].join('\n\n'),
  };
}
