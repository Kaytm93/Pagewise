import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import { completeOnboarding, getProfile, updateProfile } from '../domain/profile';
import { optionalTextField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';

const PatchBody = z.strictObject({
  federalState: optionalTextField.optional(),
  schoolType: optionalTextField.optional(),
  gradeLevel: optionalTextField.optional(),
});

/** Profil und Onboarding. Die Angaben bleiben im Datenverzeichnis und füllen später Prompt-Variablen. */
export function profileRoutes(db: Db): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Nur für die eigenen Pfade, damit die Grenze nicht auf andere Routen unter /api durchschlägt.
  app.use('/profile', limitBody(16 * 1024));
  app.use('/onboarding/*', limitBody(16 * 1024));

  app.get('/profile', (c) => c.json(getProfile(db)));

  app.patch('/profile', async (c) => {
    const body = await readJson(c, PatchBody);
    if (!body.ok) return body.response;
    return c.json(updateProfile(db, body.data));
  });

  app.post('/onboarding/complete', (c) => c.json(completeOnboarding(db)));

  return app;
}
