import { Component, type ErrorInfo, type ReactNode } from 'react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';

/** Ein nachgeladener Teil der Oberfläche fehlt, weil der Server inzwischen eine neue Version ausliefert. */
function isStaleBundle(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : '';
  return /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(text);
}

interface Props {
  children: ReactNode;
  /** Wechselt der Wert (z. B. die Adresse), wird der Fehler zurückgesetzt. */
  resetKey: string;
}

interface State {
  error: unknown;
  failed: boolean;
}

/**
 * Fängt Fehler beim Darstellen einer Ansicht ab, damit nicht die ganze App weiß wird. Der häufigste
 * Fall nach einem Update ist ein nachgeladener Teil, den es nicht mehr gibt: dann hilft Neuladen.
 * Der Fehlertext wird nicht angezeigt oder gespeichert.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, failed: false });
    }
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Bewusst nichts protokollieren: Fehlertexte können Inhalte enthalten.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const stale = isStaleBundle(this.state.error);
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-card border border-line bg-canvas p-6">
        <h1 className="font-heading text-xl">
          {stale ? m.shell.updatedTitle : m.shell.crashTitle}
        </h1>
        <p className="mt-2 text-ink-secondary">{stale ? m.shell.updatedHint : m.shell.crashHint}</p>
        <Button variant="primary" className="mt-4" onClick={() => window.location.reload()}>
          {m.shell.reload}
        </Button>
      </div>
    );
  }
}
