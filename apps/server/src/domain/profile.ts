import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { profile } from '../db/schema';

export interface ProfileView {
  federalState: string | null;
  schoolType: string | null;
  gradeLevel: string | null;
  onboardingCompleted: boolean;
}

export interface ProfilePatch {
  federalState?: string | null;
  schoolType?: string | null;
  gradeLevel?: string | null;
}

const EMPTY: ProfileView = {
  federalState: null,
  schoolType: null,
  gradeLevel: null,
  onboardingCompleted: false,
};

function view(row: typeof profile.$inferSelect | undefined): ProfileView {
  if (!row) return { ...EMPTY };
  return {
    federalState: row.federalState,
    schoolType: row.schoolType,
    gradeLevel: row.gradeLevel,
    onboardingCompleted: row.onboardingCompletedAt !== null,
  };
}

export function getProfile(db: Db): ProfileView {
  return view(db.select().from(profile).where(eq(profile.id, 1)).get());
}

/** Ändert nur die übergebenen Felder. `null` löscht ein Feld. */
export function updateProfile(db: Db, patch: ProfilePatch): ProfileView {
  db.insert(profile).values({ id: 1 }).onConflictDoNothing().run();
  const changes: ProfilePatch = {};
  if (patch.federalState !== undefined) changes.federalState = patch.federalState;
  if (patch.schoolType !== undefined) changes.schoolType = patch.schoolType;
  if (patch.gradeLevel !== undefined) changes.gradeLevel = patch.gradeLevel;
  if (Object.keys(changes).length > 0) {
    db.update(profile).set(changes).where(eq(profile.id, 1)).run();
  }
  return getProfile(db);
}

/** Markiert das Onboarding als abgeschlossen. Mehrfaches Aufrufen ändert nichts. */
export function completeOnboarding(db: Db): ProfileView {
  db.insert(profile).values({ id: 1 }).onConflictDoNothing().run();
  const row = db.select().from(profile).where(eq(profile.id, 1)).get();
  if (row && row.onboardingCompletedAt === null) {
    db.update(profile).set({ onboardingCompletedAt: new Date() }).where(eq(profile.id, 1)).run();
  }
  return getProfile(db);
}
