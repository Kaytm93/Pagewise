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
  switch (status) {
    case 'loading':
    case 'unreachable':
      return <ConnectionScreen state={status} onRetry={() => void reload()} />;
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
      <Gate />
      {status !== 'loading' && status !== 'unreachable' && <ConnectionBanner />}
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
