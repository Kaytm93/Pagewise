import { useState } from 'react';
import { PrivacyStep } from './onboarding/PrivacyStep';
import { ProfileStep } from './onboarding/ProfileStep';
import { SubjectsStep } from './onboarding/SubjectsStep';

// Provider (1a/c) und Agent-CLI (1e) kommen als weitere Schritte dazu.
const TOTAL = 3;

/** Assistent beim ersten Start: Profil, Fächer, Datenschutz. Jeder Schritt lässt sich überspringen. */
export function Onboarding() {
  const [step, setStep] = useState(1);
  const back = () => setStep((current) => Math.max(1, current - 1));
  const next = () => setStep((current) => Math.min(TOTAL, current + 1));

  if (step === 1) return <ProfileStep step={step} total={TOTAL} onNext={next} />;
  if (step === 2) return <SubjectsStep step={step} total={TOTAL} onBack={back} onNext={next} />;
  return <PrivacyStep step={step} total={TOTAL} onBack={back} />;
}
