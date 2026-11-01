import { lazy, Suspense, useEffect, useState } from 'react';
import type { ChatArtifact } from '../../../api/types';
import { messages as m } from '../../../i18n';
import { useSession } from '../../../session/SessionProvider';

const DocumentView = lazy(() => import('../blocks/DocumentView'));
const SlidesView = lazy(() => import('../blocks/SlidesView'));

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; spec: string };

/**
 * Eine Datei, die das Modell über ein Werkzeug angelegt hat (D-074): Vorschau und Download unter der Antwort.
 * Der Server liefert die geprüfte Spezifikation; Vorschau und Datei entstehen hier im Gerät, mit denselben
 * Ansichten wie die Blöcke `document` und `slides` im Text.
 */
function ArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const { api } = useSession();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    api
      .artifact(artifact.id)
      .then((detail) => {
        if (!cancelled) setLoad({ state: 'ready', spec: detail.spec });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifact.id]);

  if (load.state === 'loading') {
    return (
      <p role="status" className="my-3 text-ink-muted">
        {m.chat.artifacts.loading}
      </p>
    );
  }
  if (load.state === 'failed') {
    return (
      <p role="status" className="my-3 text-danger">
        {m.chat.artifacts.failed}
      </p>
    );
  }
  return (
    <Suspense
      fallback={
        <p role="status" className="my-3 text-ink-muted">
          {m.chat.artifacts.loading}
        </p>
      }
    >
      {artifact.kind === 'document' ? (
        <DocumentView source={load.spec} final />
      ) : (
        <SlidesView source={load.spec} final />
      )}
    </Suspense>
  );
}

/** Die Dateien einer Antwort in der Reihenfolge des Anlegens. */
export function ArtifactList({ artifacts }: { artifacts: ChatArtifact[] }) {
  if (artifacts.length === 0) return null;
  return (
    <section aria-label={m.chat.artifacts.label} className="mt-3 space-y-2">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </section>
  );
}
