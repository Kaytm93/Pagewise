import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import { messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { PasscodeField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { AuthLayout } from './AuthLayout';
import { commonErrorMessage, rateLimitMessage } from './auth-errors';

export function LoginScreen() {
  const { login } = useSession();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (passcode === '') return;
    setBusy(true);
    setError(null);
    try {
      await login(passcode);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_passcode') {
        setError(m.login.errors.invalid);
      } else if (caught instanceof ApiError && caught.code === 'rate_limited') {
        setError(rateLimitMessage(m.login.errors.rateLimited, caught));
      } else {
        setError(commonErrorMessage(caught));
      }
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={m.login.title} lead={m.login.lead}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <PasscodeField
          label={m.login.passcodeLabel}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          {m.login.submit}
        </Button>
      </form>
      <p className="mt-6 border-t border-line pt-4 text-sm text-ink-muted">{m.login.forgot}</p>
    </AuthLayout>
  );
}
