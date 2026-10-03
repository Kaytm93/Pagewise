export type SessionInfo =
  | { state: 'setup' }
  | { state: 'locked' }
  | { state: 'unlocked'; csrfToken: string };

export interface Group {
  id: string;
  name: string;
  kind: string | null;
  position: number;
}

export interface Subject {
  id: string;
  name: string;
  teacher: string | null;
  hoursPerWeek: number | null;
  icon: string | null;
  position: number;
  groups: Group[];
}

export interface Profile {
  federalState: string | null;
  schoolType: string | null;
  gradeLevel: string | null;
  onboardingCompleted: boolean;
}

export type ProfilePatch = Partial<Pick<Profile, 'federalState' | 'schoolType' | 'gradeLevel'>>;

export interface SubjectInput {
  name: string;
  teacher?: string | null;
  hoursPerWeek?: number | null;
  icon?: string | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  invalid: number;
  subjects: Subject[];
}
