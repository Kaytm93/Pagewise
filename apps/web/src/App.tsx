import type { ApiClient } from './api/client';
import { ConnectionBanner } from './connection/ConnectionBanner';
import { ConnectionProvider } from './connection/ConnectionProvider';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { LoginScreen } from './screens/LoginScreen';
import { Onboarding } from './screens/Onboarding';
import { SetupScreen } from './screens/SetupScreen';
import { SessionProvider, useSession } from './session/SessionProvider';
import { AppShell } from './shell/AppShell';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { useWorkspace, WorkspaceProvider } from './workspace/WorkspaceProvider';

/** Beim ersten Start führt der Assistent durch die Einrichtung, danach öffnet die App. */
function WorkspaceGate() {
  const { profile } = useWorkspace();
  return profile.onboardingCompleted ? <AppShell /> : <Onboarding />;
}

function Gate() {
  const { status, reload } = useSession();
  // Beim ersten Laden (und nur dann) zeigt der Vollbild-Hinweis selbst, ob der Mac erreichbar ist.
  if (status === 'loading' || status === 'unreachable') {
    return <ConnectionScreen state={status} onRetry={() => void reload()} />;
  }
  switch (status) {
    case 'setup':
      return <SetupScreen />;
    case 'locked':
      return <LoginScreen />;
    case 'unlocked':
      return (
        <WorkspaceProvider
          fallback={(state, retry) => <ConnectionScreen state={state} onRetry={retry} />}
        >
          <WorkspaceGate />
        </WorkspaceProvider>
      );
  }
}

/**
 * Rahmen samt Fehlergrenze für die ganze Oberfläche: Scheitert die Seitenleiste, die Kopfzeile oder
 * eine Zustands-Hülle beim Darstellen (z. B. neue API-Daten in einem alten Tab), bleibt der Bildschirm
 * nicht weiß, sondern zeigt einen Hinweis mit „Neu laden“. Die Grenze hängt innerhalb der Zustands-Hüllen,
 * damit ein späterer Rückfallort (Anmelde-/Verbindungsschirm) möglich bleibt.
 *
 * Der Banner „Mac nicht erreichbar“ steht hier vor dem Gate, damit er Platz im Dokumentfluss bekommt:
 * Er liegt oberhalb der Kopfzeile und schiebt sie nach unten, statt sie zu überdecken (M4-T008).
 */
function RootBoundary() {
  return (
    <ErrorBoundary resetKey="root" fullscreen>
      <Frame />
    </ErrorBoundary>
  );
}

/** Gate samt Hinweis „Mac nicht erreichbar“. Beim ersten Laden zeigt der Vollbild-Hinweis dasselbe, dort kein Banner. */
function Frame() {
  const { status } = useSession();
  return (
    <>
      {status !== 'loading' && status !== 'unreachable' && <ConnectionBanner />}
      <Gate />
    </>
  );
}

export function App({ client }: { client: ApiClient }) {
  return (
    <ConnectionProvider client={client}>
      <SessionProvider client={client}>
        <RootBoundary />
      </SessionProvider>
    </ConnectionProvider>
  );
}
