import { useState } from 'react';
import { PrivacyStep } from './onboarding/PrivacyStep';
import { ProfileStep } from './onboarding/ProfileStep';
import { ProviderStep } from './onboarding/ProviderStep';
import { SubjectsStep } from './onboarding/SubjectsStep';

// Die Erkennung der Agent-CLI (Phase 1e) kommt als weiterer Schritt dazu.
const TOTAL = 4;

/** Assistent beim ersten Start: Profil, Fächer, Anbieter, Datenschutz. Die ersten drei Schritte lassen sich überspringen. */
export function Onboarding() {
  const [step, setStep] = useState(1);
  const back = () => setStep((current) => Math.max(1, current - 1));
  const next = () => setStep((current) => Math.min(TOTAL, current + 1));

  if (step === 1) return <ProfileStep step={step} total={TOTAL} onNext={next} />;
  if (step === 2) return <SubjectsStep step={step} total={TOTAL} onBack={back} onNext={next} />;
  if (step === 3) return <ProviderStep step={step} total={TOTAL} onBack={back} onNext={next} />;
  return <PrivacyStep step={step} total={TOTAL} onBack={back} />;
}
