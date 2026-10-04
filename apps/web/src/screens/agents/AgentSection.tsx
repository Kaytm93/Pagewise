import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CliStatus, EngineProfile } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { EngineDialog } from './EngineDialog';
import { profileDetail, tokenState } from './engine-text';

/** Das gefundene Programm „claude“: Stand, Pfad und „Erneut suchen“. */
function CliBlock() {
  const { api } = useSession();
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const t = m.agents.cli;

  useEffect(() => {
    let cancelled = false;
    api
      .cliStatus()
      .then((status) => {
        if (!cancelled) setCli(status);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(commonErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function search() {
    setSearching(true);
    setError(null);
    try {
      setCli(await api.detectCli());
    } catch {
      setError(t.failed);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <h3 className="font-medium">{t.title}</h3>
      <div className="mt-2 text-sm">
        {cli === null && !error && (
          <p role="status" className="text-ink-muted">
            {t.checking}
          </p>
        )}
        {cli?.state === 'ready' && (
          <>
            <p className="text-ink-secondary">{format(t.ready, { version: cli.version ?? '' })}</p>
            <p className="mt-0.5 break-all text-ink-muted">
              {format(t.readyPath, { path: cli.path ?? '' })}
            </p>
          </>
        )}
        {cli?.state === 'missing' && <p className="text-ink-secondary">{t.missing}</p>}
        {cli?.state === 'broken' && <p className="text-ink-secondary">{t.broken}</p>}
        {cli && cli.skipped.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-ink-muted">
            {cli.skipped.map((entry) => (
              <li key={entry.path} className="break-all">
                {format(t.skipped, { path: entry.path })}
              </li>
            ))}
          </ul>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
      <Button variant="secondary" className="mt-3" busy={searching} onClick={() => void search()}>
        {searching ? t.searching : t.search}
      </Button>
    </div>
  );
}

type Dialog = { profile?: EngineProfile } | null;

/** Agent-CLI in den Einstellungen: Programm erkennen und Zugänge verwalten. Schlüssel werden nie angezeigt. */
export function AgentSection() {
  const { engines } = useWorkspace();
  const [dialog, setDialog] = useState<Dialog>(null);
  const t = m.agents.profiles;

  return (
    <div className="space-y-8">
      <CliBlock />

      <div>
        <h3 className="font-medium">{t.title}</h3>
        {engines.profiles.length === 0 ? (
          <div className="mt-3 rounded-box bg-paper p-4">
            <p className="font-medium">{t.empty}</p>
            <p className="mt-1 text-sm text-ink-secondary">{t.emptyHint}</p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {engines.profiles.map((profile) => {
              const info = engines.kinds.find((entry) => entry.kind === profile.kind);
              const token = tokenState(profile);
              return (
                <li key={profile.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 py-3">
                    <p className="truncate font-medium">{profile.name}</p>
                    <p className="truncate text-meta text-ink-muted">
                      {profileDetail(profile, info?.defaultModel ?? null)}
                      {token ? ` · ${token}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDialog({ profile })}
                    aria-label={format(t.editNamed, { name: profile.name })}
                    className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="secondary" className="mt-4" onClick={() => setDialog({})}>
          <Plus aria-hidden="true" className="size-4" />
          {t.add}
        </Button>
      </div>

      <p className="max-w-prose text-sm text-ink-muted">{m.agents.rules}</p>
      {dialog && <EngineDialog profile={dialog.profile} onClose={() => setDialog(null)} />}
    </div>
  );
}
