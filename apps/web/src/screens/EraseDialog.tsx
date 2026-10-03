import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import { messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { PasscodeField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal } from '../ui/modal';
import { commonErrorMessage, rateLimitMessage } from './auth-errors';

/** „Alles löschen“: verlangt den Passcode und lädt danach die App neu (leerer Zustand, Onboarding). */
export function EraseDialog({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e = m.settings.data.errors;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (passcode === '') return setError(e.wrongPasscode);
    setError(null);
    setBusy(true);
    try {
      await api.eraseAllData(passcode);
      // Neu laden statt Zustände einzeln zurückzusetzen: so bleibt auch im Speicher der Seite nichts übrig.
      window.location.assign('/');
    } catch (caught) {
      setBusy(false);
      if (caught instanceof ApiError && caught.code === 'invalid_passcode')
        setError(e.wrongPasscode);
      else if (caught instanceof ApiError && caught.code === 'rate_limited') {
        setError(rateLimitMessage(e.rateLimited, caught));
      } else if (caught instanceof ApiError && caught.code === 'erase_failed') setError(e.failed);
      else setError(commonErrorMessage(caught));
    }
  }

  return (
    <Modal
      title={m.settings.data.dialogTitle}
      description={m.settings.data.dialogLead}
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <PasscodeField
          label={m.settings.data.passcode}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoComplete="current-password"
          data-autofocus
        />
        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            {m.settings.data.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
