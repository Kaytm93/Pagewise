import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Api } from '../api/api';
import { ApiError } from '../api/client';
import type {
  Group,
  ImportResult,
  ModelSettings,
  Profile,
  ProfilePatch,
  Provider,
  ProviderInput,
  ProviderPatch,
  Selection,
  Subject,
  SubjectInput,
  SubjectTemplate,
} from '../api/types';
import { useSession } from '../session/SessionProvider';

/** Ergebnis von „Fächer aus Vorlagen anlegen“. */
export interface TemplateResult {
  /** Die neu angelegten Fächer in der Reihenfolge der Auswahl. */
  created: Subject[];
  /** Fächer, die es schon gab (gleicher Name). */
  skipped: number;
}

interface WorkspaceValue {
  profile: Profile;
  /** Die Fächer des Nutzers, ohne das eingebaute Fach „Standard“. */
  subjects: Subject[];
  /** Das eingebaute Fach „Standard“ für den fachunabhängigen Chat. Immer vorhanden. */
  defaultSubject: Subject;
  /** Ein Fach nach ID, auch das eingebaute. */
  findSubject: (id: string) => Subject | undefined;
  saveProfile: (patch: ProfilePatch) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  addSubject: (input: SubjectInput) => Promise<Subject>;
  /** Legt mehrere Fächer aus Katalogvorlagen an (mit Schlüssel für den Standard-Prompt). */
  addTemplateSubjects: (templates: SubjectTemplate[]) => Promise<TemplateResult>;
  editSubject: (id: string, patch: Partial<SubjectInput>) => Promise<Subject>;
  removeSubject: (id: string) => Promise<void>;
  setSubjectModel: (id: string, model: Selection | null) => Promise<void>;
  importSubjects: (format: 'json' | 'csv', content: string) => Promise<ImportResult>;
  addGroup: (subjectId: string, input: { name: string; kind?: string | null }) => Promise<Group>;
  editGroup: (id: string, patch: { name?: string; kind?: string | null }) => Promise<Group>;
  removeGroup: (id: string) => Promise<void>;
  providers: Provider[];
  modelSettings: ModelSettings;
  addProvider: (input: ProviderInput) => Promise<Provider>;
  editProvider: (id: string, patch: ProviderPatch) => Promise<Provider>;
  removeProvider: (id: string) => Promise<void>;
  saveModelSettings: (settings: ModelSettings) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace braucht einen WorkspaceProvider');
  return value;
}

type Loaded = {
  profile: Profile;
  subjects: Subject[];
  defaultSubject: Subject;
  providers: Provider[];
  modelSettings: ModelSettings;
};
type LoadState = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Loaded);

/** Lädt Profil und Fächer, sobald die Anmeldung steht, und hält sie aktuell. */
export function WorkspaceProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  /** Ansicht für „lädt“ und „Server antwortet nicht“. */
  fallback: (state: 'loading' | 'unreachable', retry: () => void) => ReactNode;
}) {
  const { api } = useSession();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` löst das erneute Laden aus
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    Promise.all([api.profile(), api.subjects(), api.providers(), api.modelSettings()])
      .then(([profile, list, providers, modelSettings]) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            profile,
            subjects: list.subjects,
            defaultSubject: list.defaultSubject,
            providers,
            modelSettings,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const value = useMemo<WorkspaceValue | null>(() => {
    if (state.status !== 'ready') return null;
    return buildValue(api, state, (patch) =>
      setState((current) => (current.status === 'ready' ? { ...current, ...patch } : current)),
    );
  }, [api, state]);

  if (!value) return fallback(state.status === 'error' ? 'unreachable' : 'loading', retry);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function buildValue(
  api: Api,
  state: Loaded,
  update: (patch: Partial<Loaded>) => void,
): WorkspaceValue {
  /** Nach jeder Änderung die Liste neu holen: Reihenfolge und Untergruppen kommen vom Server. */
  const refreshSubjects = async () => {
    const list = await api.subjects();
    update({ subjects: list.subjects, defaultSubject: list.defaultSubject });
  };
  /** Anbieter und Modellwahl hängen zusammen (Löschen räumt die Wahl auf), deshalb zusammen holen. */
  const refreshProviders = async () => {
    const [providers, modelSettings] = await Promise.all([api.providers(), api.modelSettings()]);
    update({ providers, modelSettings });
  };

  return {
    profile: state.profile,
    subjects: state.subjects,
    defaultSubject: state.defaultSubject,
    findSubject: (id) =>
      state.defaultSubject.id === id
        ? state.defaultSubject
        : state.subjects.find((entry) => entry.id === id),
    providers: state.providers,
    modelSettings: state.modelSettings,
    saveProfile: async (patch) => update({ profile: await api.updateProfile(patch) }),
    completeOnboarding: async () => update({ profile: await api.completeOnboarding() }),
    addSubject: async (input) => {
      const subject = await api.createSubject(input);
      await refreshSubjects();
      return subject;
    },
    addTemplateSubjects: async (templates) => {
      const result: TemplateResult = { created: [], skipped: 0 };
      try {
        // Nacheinander, in der Reihenfolge des Katalogs.
        for (const template of templates) {
          try {
            result.created.push(
              await api.createSubject({
                name: template.name,
                icon: template.icon,
                ...(template.key ? { templateKey: template.key } : {}),
              }),
            );
          } catch (caught) {
            if (caught instanceof ApiError && caught.code === 'name_taken') result.skipped += 1;
            else throw caught;
          }
        }
      } finally {
        // Auch nach einem Fehler: Was schon angelegt ist, soll in der Liste stehen.
        await refreshSubjects();
      }
      return result;
    },
    editSubject: async (id, patch) => {
      const subject = await api.updateSubject(id, patch);
      await refreshSubjects();
      return subject;
    },
    removeSubject: async (id) => {
      await api.deleteSubject(id);
      await refreshSubjects();
    },
    setSubjectModel: async (id, model) => {
      await api.setSubjectModel(id, model);
      await refreshSubjects();
    },
    importSubjects: async (format, content) => {
      const result = await api.importSubjects(format, content);
      update({ subjects: result.subjects });
      return result;
    },
    addGroup: async (subjectId, input) => {
      const group = await api.createGroup(subjectId, input);
      await refreshSubjects();
      return group;
    },
    editGroup: async (id, patch) => {
      const group = await api.updateGroup(id, patch);
      await refreshSubjects();
      return group;
    },
    removeGroup: async (id) => {
      await api.deleteGroup(id);
      await refreshSubjects();
    },
    addProvider: async (input) => {
      const provider = await api.createProvider(input);
      await refreshProviders();
      return provider;
    },
    editProvider: async (id, patch) => {
      const provider = await api.updateProvider(id, patch);
      await refreshProviders();
      return provider;
    },
    removeProvider: async (id) => {
      await api.deleteProvider(id);
      await refreshProviders();
    },
    saveModelSettings: async (settings) => {
      update({ modelSettings: await api.saveModelSettings(settings) });
    },
  };
}
