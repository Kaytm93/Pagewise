import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import { messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { PasscodeField, TextField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { AuthLayout } from './AuthLayout';
import { commonErrorMessage, rateLimitMessage } from './auth-errors';

type Errors = { code?: string; passcode?: string; repeat?: string; form?: string };

/** Entspricht der Zählung des Servers (Unicode-Zeichen nach Normalisierung). */
function passcodeLength(value: string): number {
  return [...value.normalize('NFKC')].length;
}

function messageFor(error: unknown): Errors {
  if (!(error instanceof ApiError)) return { form: commonErrorMessage(error) };
  const s = m.setup.errors;
  switch (error.code) {
    case 'invalid_setup_code':
      return { code: s.invalidCode };
    case 'invalid_input':
      return error.details.reason === 'too_long'
        ? { passcode: s.tooLong }
        : { passcode: s.tooShort };
    case 'already_configured':
      return { form: s.alreadyConfigured };
    case 'rate_limited':
      return { form: rateLimitMessage(s.rateLimited, error) };
    default:
      return { form: commonErrorMessage(error) };
  }
}

export function SetupScreen() {
  const { setup } = useSession();
  const [code, setCode] = useState('');
  const [passcode, setPasscode] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (passcodeLength(passcode) < 8) next.passcode = m.setup.errors.tooShort;
    else if (passcode !== repeat) next.repeat = m.setup.errors.mismatch;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await setup(code.trim(), passcode);
    } catch (error) {
      setErrors(messageFor(error));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={m.setup.title} lead={m.setup.lead}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <TextField
          label={m.setup.codeLabel}
          hint={m.setup.codeHint}
          error={errors.code}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="[&_input]:font-mono [&_input]:uppercase [&_input]:tracking-wider"
          required
        />
        <PasscodeField
          label={m.setup.passcodeLabel}
          hint={m.setup.passcodeHint}
          error={errors.passcode}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoComplete="new-password"
          required
        />
        <PasscodeField
          label={m.setup.repeatLabel}
          error={errors.repeat}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
          required
        />
        {errors.form && <FieldError>{errors.form}</FieldError>}
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          {m.setup.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
