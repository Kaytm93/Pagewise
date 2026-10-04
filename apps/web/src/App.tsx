import type { ApiClient } from './api/client';
import { ConnectionBanner } from './connection/ConnectionBanner';
import { ConnectionProvider } from './connection/ConnectionProvider';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { LoginScreen } from './screens/LoginScreen';
import { Onboarding } from './screens/Onboarding';
import { SetupScreen } from './screens/SetupScreen';
import { SessionProvider, useSession } from './session/SessionProvider';
import { AppShell } from './shell/AppShell';
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
        <Frame />
      </SessionProvider>
    </ConnectionProvider>
  );
}
