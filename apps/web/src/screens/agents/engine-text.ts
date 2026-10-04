import { ApiError } from '../../api/client';
import type { EngineKind, EngineProfile } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { commonErrorMessage } from '../auth-errors';

export interface EngineErrors {
  name?: string;
  model?: string;
  token?: string;
  timeout?: string;
  form?: string;
}

export const kindLabel = (kind: EngineKind): string => m.agents.kinds[kind];

/** Ordnet Fehlercodes des Servers dem Feld zu, in dem sie angezeigt werden. */
export function mapEngineError(error: unknown): EngineErrors {
  const e = m.agents.errors;
  if (error instanceof ApiError) {
    if (error.code === 'name_taken') return { name: e.nameTaken };
    if (error.code === 'too_many') return { form: e.tooMany };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      const { field, reason } = error.details;
      if (field === 'name') return { name: m.errors.invalidName };
      if (field === 'model') return { model: e.invalidModel };
      if (field === 'timeoutMinutes') return { timeout: e.invalidTimeout };
      if (field === 'token') {
        return { token: reason === 'token_required' ? e.tokenRequired : e.tokenInvalid };
      }
    }
  }
  return { form: commonErrorMessage(error) };
}

/** „GLM Coding Plan (Z.ai) · glm-5.3-flash · höchstens 20 Min.“ */
export function profileDetail(profile: EngineProfile, defaultModel: string | null): string {
  return format(m.agents.profiles.detail, {
    kind: kindLabel(profile.kind),
    model: profile.model ?? defaultModel ?? m.agents.profiles.defaultModel,
    minutes: profile.timeoutMinutes,
  });
}

export function tokenState(profile: EngineProfile): string | null {
  if (!profile.hasToken) return null;
  return profile.tokenHint
    ? format(m.agents.profiles.tokenSetEnding, { last4: profile.tokenHint })
    : m.agents.profiles.tokenSet;
}
