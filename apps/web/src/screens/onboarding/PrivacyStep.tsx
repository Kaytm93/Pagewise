import { useState } from 'react';
import { messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { StepFrame } from './StepFrame';

export function PrivacyStep({
  step,
  total,
  onBack,
}: {
  step: number;
  total: number;
  onBack: () => void;
}) {
  const { completeOnboarding } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
    } catch (caught) {
      setError(commonErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <StepFrame
      step={step}
      total={total}
      title={m.onboarding.privacy.title}
      lead={m.onboarding.privacy.lead}
    >
      <ul className="space-y-3">
        {m.onboarding.privacy.points.map((point) => (
          <li key={point} className="flex gap-3 text-ink-secondary">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-pill bg-ink-muted"
            />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      {error && <FieldError>{error}</FieldError>}
      <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {m.common.back}
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void finish()}>
          {m.onboarding.privacy.finish}
        </Button>
      </div>
    </StepFrame>
  );
}
