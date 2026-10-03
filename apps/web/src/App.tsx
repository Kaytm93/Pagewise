import type { ApiClient } from './api/client';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SetupScreen } from './screens/SetupScreen';
import { SessionProvider, useSession } from './session/SessionProvider';
import { AppShell } from './shell/AppShell';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';

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
          <AppShell />
        </WorkspaceProvider>
      );
  }
}

export function App({ client }: { client: ApiClient }) {
  return (
    <SessionProvider client={client}>
      <Gate />
    </SessionProvider>
  );
}
