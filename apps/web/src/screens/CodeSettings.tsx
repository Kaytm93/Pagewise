import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CodeStatus } from '../api/types';
import { format, messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { CheckField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal, ModalFooter } from '../ui/modal';

type Dialog = 'enable' | 'setup' | null;

/**
 * Einstellungen der Code-Ausführung (D-079): der Schalter (standardmäßig aus, mit Erklärung vor dem Einschalten),
 * das private Python (Einrichtung nur auf Klick, nach einer Erklärung) und sein Zustand. Während der Einrichtung
 * fragt die Ansicht den Fortschritt regelmäßig ab.
 */
export function CodeChoice() {
  const { api } = useSession();
  const t = m.settings.code;
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.codeStatus());
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.setup.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 1_500);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function run(action: () => Promise<unknown>) {
    setFailed(false);
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return failed ? (
      <FieldError>{t.failed}</FieldError>
    ) : (
      <p role="status" className="text-ink-muted">
        {t.loading}
      </p>
    );
  }
  if (!status.supported) return <p className="text-ink-secondary">{t.unsupported}</p>;

  const setup = status.setup;
  const phase = setup.phase ? (t.phases as Record<string, string>)[setup.phase] : null;
  const percent = setup.progress === null ? null : Math.round(setup.progress * 100);
  const errorReason = setup.error
    ? ((t.errors as Record<string, string>)[setup.error] ?? t.errors.setup_failed)
    : null;
  const runtimeText =
    status.runtime === 'ready'
      ? status.ready
        ? t.runtime.ready
        : t.runtime.notReady
      : status.runtime === 'outdated'
        ? t.runtime.outdated
        : t.runtime.missing;
  const outdated = status.runtime === 'outdated' && !running;

  const missing = [
    ...(status.preview.office ? [] : [t.preview.office]),
    ...(status.preview.raster ? [] : [t.preview.raster]),
  ];

  return (
    <div>
      <CheckField
        label={t.label}
        hint={t.hint}
        checked={status.enabled}
        onChange={(next) => {
          if (next) setDialog('enable');
          else void run(() => api.setCodeEnabled(false));
        }}
      />

      {outdated && (
        <div
          role="alert"
          data-testid="code-outdated-banner"
          className="mo-rise mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-control border border-control-edge bg-surface px-4 py-3 text-sm text-ink"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1">{t.runtime.outdatedBanner}</span>
          <Button variant="secondary" disabled={busy} onClick={() => setDialog('setup')}>
            {t.resetup}
          </Button>
        </div>
      )}

      <div className="mt-3 text-sm">
        {running ? (
          <p role="status" className="text-ink-secondary">
            {phase}
            {percent !== null && ` ${format(t.progress, { percent: String(percent) })}`}
          </p>
        ) : (
          <p className="text-ink-secondary">{runtimeText}</p>
        )}
        {errorReason && !running && (
          <FieldError>{format(t.errorPrefix, { reason: errorReason })}</FieldError>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="secondary" onClick={() => void run(() => api.cancelCodeSetup())}>
              {t.cancel}
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setDialog('setup')}>
              {status.runtime === 'missing' ? t.setup : t.resetup}
            </Button>
          )}
          {status.runtime !== 'missing' && !running && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => api.removeCodeRuntime())}
            >
              {t.remove}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-secondary">
        <span className="font-medium">{t.preview.title}: </span>
        {missing.length === 0
          ? t.preview.ready
          : format(t.preview.missing, { missing: missing.join(', ') })}
      </p>
      {failed && <FieldError>{t.failed}</FieldError>}

      {dialog === 'enable' && (
        <Modal title={t.enableTitle} description={t.enableLead} onClose={() => setDialog(null)}>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {t.enablePoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {m.common.cancel}
            </Button>
            <Button
              variant="primary"
              data-autofocus
              busy={busy}
              onClick={() => {
                void run(() => api.setCodeEnabled(true)).then(() => setDialog(null));
              }}
            >
              {t.enableConfirm}
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {dialog === 'setup' && (
        <Modal title={t.setupTitle} description={t.setupLead} onClose={() => setDialog(null)}>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {t.setupPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {m.common.cancel}
            </Button>
            <Button
              variant="primary"
              data-autofocus
              busy={busy}
              onClick={() => {
                void run(() => api.startCodeSetup()).then(() => setDialog(null));
              }}
            >
              {t.setupConfirm}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
