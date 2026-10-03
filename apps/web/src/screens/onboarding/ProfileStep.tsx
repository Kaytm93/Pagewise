import { type FormEvent, useState } from 'react';
import { messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { StepFrame } from './StepFrame';

export function ProfileStep({
  step,
  total,
  onNext,
}: {
  step: number;
  total: number;
  onNext: () => void;
}) {
  const { profile, saveProfile } = useWorkspace();
  const [federalState, setFederalState] = useState(profile.federalState ?? '');
  const [schoolType, setSchoolType] = useState(profile.schoolType ?? '');
  const [gradeLevel, setGradeLevel] = useState(profile.gradeLevel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const values = { federalState, schoolType, gradeLevel };
    const empty = Object.values(values).every((value) => value.trim() === '');
    if (empty && !profile.federalState && !profile.schoolType && !profile.gradeLevel) {
      onNext();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfile(values);
      onNext();
    } catch (caught) {
      setError(commonErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <StepFrame
      step={step}
      total={total}
      title={m.onboarding.profile.title}
      lead={m.onboarding.profile.lead}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <TextField
          label={m.onboarding.profile.federalState}
          optional
          value={federalState}
          onChange={(event) => setFederalState(event.target.value)}
          maxLength={80}
          autoComplete="off"
        />
        <TextField
          label={m.onboarding.profile.schoolType}
          optional
          value={schoolType}
          onChange={(event) => setSchoolType(event.target.value)}
          maxLength={80}
          autoComplete="off"
        />
        <TextField
          label={m.onboarding.profile.gradeLevel}
          optional
          value={gradeLevel}
          onChange={(event) => setGradeLevel(event.target.value)}
          maxLength={80}
          autoComplete="off"
        />
        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onNext} disabled={busy}>
            {m.common.skip}
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {m.common.next}
          </Button>
        </div>
      </form>
    </StepFrame>
  );
}
