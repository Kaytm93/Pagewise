import { useEffect, useState } from 'react';
import type { Provider, ProviderPreset, TestOutcome } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldError } from '../../ui/FieldError';
import { Modal } from '../../ui/modal';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { ProviderForm } from './ProviderForm';
import { testMessage } from './provider-text';

/** Anbieter hinzufügen (ohne `provider`) oder bearbeiten, samt Verbindungstest und Löschen mit Rückfrage. */
export function ProviderDialog({
  provider,
  onClose,
}: {
  provider?: Provider;
  onClose: () => void;
}) {
  const { api } = useSession();
  const { removeProvider } = useWorkspace();
  const [presets, setPresets] = useState<ProviderPreset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .providerPresets()
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(commonErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function test() {
    if (!provider) return;
    setTesting(true);
    setOutcome(null);
    setError(null);
    try {
      setOutcome(await api.testProvider(provider.id));
    } catch (caught) {
      setError(commonErrorMessage(caught));
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    if (!provider) return;
    setBusy(true);
    try {
      await removeProvider(provider.id);
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setError(commonErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        wide
        title={provider ? m.providers.form.editTitle : m.providers.form.createTitle}
        onClose={onClose}
      >
        {loadError && <FieldError>{loadError}</FieldError>}
        {presets && (
          <ProviderForm
            provider={provider}
            presets={presets}
            choosePreset
            submitLabel={m.common.save}
            onSaved={onClose}
            onUnchanged={onClose}
            onCancel={onClose}
            extraActions={
              provider && (
                <>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                    {m.providers.form.delete}
                  </Button>
                  <Button variant="secondary" busy={testing} onClick={() => void test()}>
                    {testing ? m.providers.form.testing : m.providers.form.test}
                  </Button>
                </>
              )
            }
          />
        )}
        {outcome && (
          <p
            role="status"
            className={`mt-3 text-sm ${outcome.ok ? 'text-ink-secondary' : 'text-danger'}`}
          >
            {testMessage(outcome)}
          </p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </Modal>
      {confirmDelete && provider && (
        <ConfirmDialog
          title={format(m.confirm.deleteProviderTitle, { name: provider.name })}
          description={m.confirm.deleteProviderBody}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void onDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
