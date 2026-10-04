import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Exam, ExamInput, TimetableEntry, TimetableInput, WeekAnchor } from '../api/types';
import { useSession } from '../session/SessionProvider';

interface PlannerValue {
  status: 'loading' | 'ready' | 'error';
  entries: TimetableEntry[];
  exams: Exam[];
  weekAnchor: WeekAnchor | null;
  /** „Jetzt“ für Anzeigen wie die laufende Stunde; wird jede halbe Minute neu gelesen. */
  now: Date;
  reload: () => Promise<void>;
  addLesson: (input: TimetableInput) => Promise<TimetableEntry>;
  editLesson: (id: string, patch: Partial<TimetableInput>) => Promise<TimetableEntry>;
  removeLesson: (id: string) => Promise<void>;
  setWeek: (anchor: { date: string; week: 'a' | 'b' } | null) => Promise<void>;
  addExam: (input: ExamInput) => Promise<Exam>;
  editExam: (id: string, patch: Partial<ExamInput>) => Promise<Exam>;
  removeExam: (id: string) => Promise<void>;
}

const PlannerContext = createContext<PlannerValue | null>(null);

export function usePlanner(): PlannerValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error('usePlanner braucht einen PlannerProvider');
  return value;
}

const byTime = (a: TimetableEntry, b: TimetableEntry) =>
  a.weekday - b.weekday || a.startTime.localeCompare(b.startTime);
const byDate = (a: Exam, b: Exam) =>
  a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');

/**
 * Stundenplan und Tests für die ganze angemeldete App: wird einmal geladen und bei jeder Änderung hier
 * aktualisiert. Die Daten bleiben lokal; die KI sieht sie nur über die Werkzeuge auf dem Server.
 */
export function PlannerProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [status, setStatus] = useState<PlannerValue['status']>('loading');
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [weekAnchor, setWeekAnchor] = useState<WeekAnchor | null>(null);
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(async () => {
    try {
      const [timetable, list] = await Promise.all([api.timetable(), api.exams()]);
      setEntries([...timetable.entries].sort(byTime));
      setWeekAnchor(timetable.weekAnchor);
      setExams([...list].sort(byDate));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const value = useMemo<PlannerValue>(
    () => ({
      status,
      entries,
      exams,
      weekAnchor,
      now,
      reload,
      addLesson: async (input) => {
        const created = await api.createTimetableEntry(input);
        setEntries((current) => [...current, created].sort(byTime));
        return created;
      },
      editLesson: async (id, patch) => {
        const updated = await api.updateTimetableEntry(id, patch);
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? updated : entry)).sort(byTime),
        );
        return updated;
      },
      removeLesson: async (id) => {
        await api.deleteTimetableEntry(id);
        setEntries((current) => current.filter((entry) => entry.id !== id));
      },
      setWeek: async (anchor) => {
        setWeekAnchor(await api.setWeekAnchor(anchor));
      },
      addExam: async (input) => {
        const created = await api.createExam(input);
        setExams((current) => [...current, created].sort(byDate));
        return created;
      },
      editExam: async (id, patch) => {
        const updated = await api.updateExam(id, patch);
        setExams((current) =>
          current.map((exam) => (exam.id === id ? updated : exam)).sort(byDate),
        );
        return updated;
      },
      removeExam: async (id) => {
        await api.deleteExam(id);
        setExams((current) => current.filter((exam) => exam.id !== id));
      },
    }),
    [api, status, entries, exams, weekAnchor, now, reload],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}
