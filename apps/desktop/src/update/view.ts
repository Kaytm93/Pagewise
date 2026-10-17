import { format, messages as m } from '../i18n';
import { shortCommit } from './build-info';
import {
  type InstalledInfo,
  MAX_CHANGES,
  type ReadyUpdate,
  STEP_ORDER,
  type StepId,
  type UnsupportedReason,
  type UpdateErrorCode,
} from './service';

/**
 * Was das Update-Fenster zeigt. Wie beim Verbindungsfenster baut die Seite ihre Anzeige aus diesem Objekt (nur mit
 * `textContent`, nie mit HTML): Die Texte kommen aus `i18n.ts` und stehen hier fertig eingesetzt. Auch Betreffzeilen
 * von Commits und Zeilen der Ausgabe sind nur Text, sie kommen aus dem Netz.
 */
export type Stage =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'working'
  | 'ready'
  | 'failed';

export type ActionId = keyof typeof m.update.actions;
export type MessageId = keyof typeof m.update.results;

export interface UpdateState {
  stage: Stage;
  unsupported: UnsupportedReason | null;
  remote: { commit: string; date: string | null } | null;
  changes: string[];
  changeCount: number | null;
  step: StepId | null;
  lines: string[];
  error: { code: UpdateErrorCode; during: 'check' | 'prepare' } | null;
  checkedAt: Date | null;
  ready: ReadyUpdate | null;
  message: MessageId | null;
}

export interface UpdateView {
  stage: Stage;
  /** Es läuft etwas: Die Seite fragt dann öfter nach dem Stand. */
  busy: boolean;
  title: string;
  body: string;
  facts: Array<{ label: string; value: string }>;
  changes: { label: string; items: string[]; more: string | null; unknown: string | null } | null;
  steps: Array<{ id: StepId; label: string; state: 'pending' | 'active' | 'done' }> | null;
  stepNote: string | null;
  log: { label: string; lines: string[] } | null;
  actions: Array<{ id: ActionId; label: string }>;
  autoCheck: { checked: boolean; label: string; note: string };
  message: string | null;
  untouched: string | null;
  texts: { windowTitle: string; title: string; intro: string };
}

export const LOG_LINES_SHOWN = 14;

export interface ViewExtras {
  installed: InstalledInfo;
  autoCheck: boolean;
  /** Formatierer für Datum und Uhrzeit (austauschbar für Tests). */
  formatDate?: (iso: string) => string;
  formatTime?: (date: Date) => string;
}

const defaultDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(date);
};
const defaultTime = (date: Date): string =>
  new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(date);

function versionText(
  commit: string | null,
  date: string | null,
  dirty: boolean,
  formatDate: (iso: string) => string,
): string {
  const short = shortCommit(commit);
  if (!short) return m.update.versionUnknown;
  const parts = [short];
  const day = date ? formatDate(date) : '';
  if (day) parts.push(day);
  if (dirty) parts.push(m.update.localChanges);
  return parts.join(' · ');
}

/** Welche Beschriftung der Menüpunkt für Updates im Menü und im Menüleisten-Symbol trägt. */
export function updateMenuKey(
  stage: Stage,
): 'checkForUpdates' | 'updateAvailable' | 'updateWorking' | 'updateReady' | 'updateFailed' {
  switch (stage) {
    case 'available':
      return 'updateAvailable';
    case 'working':
      return 'updateWorking';
    case 'ready':
      return 'updateReady';
    case 'failed':
      return 'updateFailed';
    default:
      return 'checkForUpdates';
  }
}

const label = (id: ActionId): { id: ActionId; label: string } => ({
  id,
  label: m.update.actions[id],
});

export function buildUpdateView(state: UpdateState, extras: ViewExtras): UpdateView {
  const formatDate = extras.formatDate ?? defaultDate;
  const formatTime = extras.formatTime ?? defaultTime;
  const { stage } = state;
  const texts = m.update.stages[stage];
  const title: string = texts.title;
  let body: string = texts.body;
  const actions: UpdateView['actions'] = [];
  let busy = false;
  let untouched: string | null = null;

  switch (stage) {
    case 'unsupported':
      body = state.unsupported ? m.update.unsupported[state.unsupported] : '';
      break;
    case 'idle':
      body = m.update.intro;
      actions.push(label('check'));
      break;
    case 'checking':
      busy = true;
      break;
    case 'up-to-date':
      body = format(m.update.stages['up-to-date'].body, {
        time: state.checkedAt ? formatTime(state.checkedAt) : '',
      });
      actions.push(label('recheck'));
      break;
    case 'available':
      actions.push(label('start'), label('recheck'));
      break;
    case 'working':
      busy = true;
      actions.push(label('cancel'));
      break;
    case 'ready':
      actions.push(label('restart'), label('recheck'));
      break;
    case 'failed': {
      const code = state.error?.code ?? 'unsupported';
      body = m.update.errors[code];
      untouched = m.update.untouched;
      actions.push(label(state.error?.during === 'check' ? 'retry-check' : 'retry-start'));
      if (state.lines.length > 0) actions.push(label('show-log'));
      break;
    }
  }

  const facts: UpdateView['facts'] = [];
  if (stage !== 'unsupported') {
    facts.push({
      label: m.update.installedLabel,
      value: versionText(
        extras.installed.commit,
        extras.installed.commitDate,
        extras.installed.dirty,
        formatDate,
      ),
    });
  }
  if (
    state.remote &&
    (stage === 'available' || stage === 'working' || stage === 'ready' || stage === 'failed')
  ) {
    facts.push({
      label: m.update.newLabel,
      value: versionText(state.remote.commit, state.remote.date, false, formatDate),
    });
  }

  let changes: UpdateView['changes'] = null;
  if (stage === 'available' || stage === 'ready') {
    if (state.changes.length > 0) {
      const extra =
        state.changeCount !== null && state.changeCount > state.changes.length
          ? state.changeCount - state.changes.length
          : 0;
      changes = {
        label: m.update.changesLabel,
        items: state.changes.slice(0, MAX_CHANGES),
        more: extra > 0 ? format(m.update.moreChanges, { count: extra }) : null,
        unknown: null,
      };
    } else if (stage === 'available') {
      changes = {
        label: m.update.changesLabel,
        items: [],
        more: null,
        unknown: m.update.changesUnknown,
      };
    }
  }

  let steps: UpdateView['steps'] = null;
  let stepNote: string | null = null;
  if (stage === 'working' || (stage === 'failed' && state.error?.during === 'prepare')) {
    const current = state.step ? STEP_ORDER.indexOf(state.step) : -1;
    steps = STEP_ORDER.map((id, index) => ({
      id,
      label: m.update.steps[id],
      state:
        stage === 'working'
          ? index < current
            ? 'done'
            : index === current
              ? 'active'
              : 'pending'
          : index < current
            ? 'done'
            : 'pending',
    }));
    if (stage === 'working' && current >= 0) {
      stepNote = format(m.update.stepOf, { current: current + 1, total: STEP_ORDER.length });
    }
  }

  const lines = state.lines.slice(-LOG_LINES_SHOWN);
  const showLog = (stage === 'working' || stage === 'failed') && lines.length > 0;

  return {
    stage,
    busy,
    title,
    body,
    facts,
    changes,
    steps,
    stepNote,
    log: showLog ? { label: m.update.detailsLabel, lines } : null,
    actions,
    autoCheck: {
      checked: extras.autoCheck,
      label: m.update.autoCheck,
      note: m.update.autoCheckNote,
    },
    message: state.message ? m.update.results[state.message] : null,
    untouched,
    texts: { windowTitle: m.update.windowTitle, title: m.update.title, intro: m.update.intro },
  };
}
