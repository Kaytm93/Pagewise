import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { CheckField, PasscodeField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { type FxPreference, readFx, saveFx } from '../ui/fx';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { readTheme, saveTheme, type ThemePreference } from '../ui/theme';
import { AgentSection } from './agents/AgentSection';
import { commonErrorMessage, rateLimitMessage } from './auth-errors';
import { EraseDialog } from './EraseDialog';
import { PromptRow } from './prompts/PromptRow';
import { ProvidersSection } from './providers/ProvidersSection';

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="font-heading text-xl">{title}</h2>
      {lead && <p className="mt-1 text-ink-secondary">{lead}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: m.settings.appearance.system },
  { value: 'light', label: m.settings.appearance.light },
  { value: 'dark', label: m.settings.appearance.dark },
];

function ThemeChoice() {
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme());

  function choose(value: ThemePreference) {
    setTheme(value);
    saveTheme(value);
  }

  return (
    <Segmented
      legend={m.settings.appearance.title}
      options={THEMES}
      value={theme}
      onChange={choose}
    />
  );
}

const EFFECTS: { value: FxPreference; label: string }[] = [
  { value: 'system', label: m.settings.appearance.effects.system },
  { value: 'full', label: m.settings.appearance.effects.full },
  { value: 'reduced', label: m.settings.appearance.effects.reduced },
  { value: 'off', label: m.settings.appearance.effects.off },
];

/** Wie viel sich bewegt (Effektstufe): „Automatisch“ folgt dem Gerät, sonst gilt die Wahl. */
function EffectsChoice() {
  const [effects, setEffects] = useState<FxPreference>(() => readFx());
  const e = m.settings.appearance.effects;

  function choose(value: FxPreference) {
    setEffects(value);
    saveFx(value);
  }

  return (
    <div className="mt-8">
      <h3 className="font-heading text-lg">{e.title}</h3>
      <p className="mt-1 mb-4 max-w-[52ch] text-sm text-ink-muted">{e.lead}</p>
      <Segmented legend={e.title} options={EFFECTS} value={effects} onChange={choose} />
      <p className="mt-3 max-w-[52ch] text-sm text-ink-secondary">{e.help[effects]}</p>
    </div>
  );
}

/** Der globale Schalter: darf die KI Stundenplan und Tests über Werkzeuge einsehen? (Standard: ja.) */
function ToolsChoice() {
  const { api } = useSession();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const t = m.settings.tools;

  useEffect(() => {
    let cancelled = false;
    api
      .toolsEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function change(next: boolean) {
    setFailed(false);
    const before = enabled;
    setEnabled(next);
    try {
      setEnabled(await api.setToolsEnabled(next));
    } catch {
      setEnabled(before);
      setFailed(true);
    }
  }

  if (enabled === null && !failed) {
    return (
      <p role="status" className="text-ink-muted">
        {t.loading}
      </p>
    );
  }
  return (
    <div>
      <CheckField
        label={t.label}
        hint={t.hint}
        checked={enabled ?? true}
        onChange={(value) => void change(value)}
      />
      {failed && <FieldError>{t.failed}</FieldError>}
    </div>
  );
}

function ChangePasscode() {
  const { api } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<{
    current?: string;
    next?: string;
    repeat?: string;
    form?: string;
  }>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const e = m.settings.access.errors;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if ([...next.normalize('NFKC')].length < 8) return setErrors({ next: e.tooShort });
    if (next !== repeat) return setErrors({ repeat: e.mismatch });

    setErrors({});
    setBusy(true);
    try {
      await api.changePasscode(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_passcode') {
        setErrors({ current: e.wrongCurrent });
      } else if (caught instanceof ApiError && caught.code === 'invalid_input') {
        setErrors({ next: caught.details.reason === 'too_long' ? e.tooLong : e.tooShort });
      } else if (caught instanceof ApiError && caught.code === 'rate_limited') {
        setErrors({ form: rateLimitMessage(e.rateLimited, caught) });
      } else {
        setErrors({ form: commonErrorMessage(caught) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-5" noValidate>
      <h3 className="font-medium">{m.settings.access.changeTitle}</h3>
      <PasscodeField
        label={m.settings.access.current}
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        error={errors.current}
        autoComplete="current-password"
      />
      <PasscodeField
        label={m.settings.access.next}
        value={next}
        onChange={(event) => setNext(event.target.value)}
        error={errors.next}
        hint={m.setup.passcodeHint}
        autoComplete="new-password"
      />
      <PasscodeField
        label={m.settings.access.repeat}
        value={repeat}
        onChange={(event) => setRepeat(event.target.value)}
        error={errors.repeat}
        autoComplete="new-password"
      />
      {errors.form && <FieldError>{errors.form}</FieldError>}
      {done && (
        <p role="status" className="text-sm text-ink-secondary">
          {m.settings.access.success}
        </p>
      )}
      <Button type="submit" variant="secondary" busy={busy}>
        {m.settings.access.submit}
      </Button>
    </form>
  );
}

function EraseAll() {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-xl">
      <h3 className="font-medium">{m.settings.data.eraseTitle}</h3>
      <p className="mt-1 text-sm text-ink-secondary">{m.settings.data.eraseLead}</p>
      <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
        {m.settings.data.eraseOpen}
      </Button>
      {open && <EraseDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

export function SettingsPage() {
  const { logout } = useSession();
  const [leaving, setLeaving] = useState(false);

  return (
    <Sheet>
      <h1 className="font-heading text-3xl tracking-tight text-balance sm:text-title">
        {m.settings.title}
      </h1>
      <div className="mt-8">
        <Section title={m.settings.appearance.title} lead={m.settings.appearance.lead}>
          <ThemeChoice />
          <EffectsChoice />
        </Section>
        <Section title={m.providers.title} lead={m.providers.lead}>
          <ProvidersSection />
        </Section>
        <Section title={m.settings.tools.title} lead={m.settings.tools.lead}>
          <ToolsChoice />
        </Section>
        <Section title={m.agents.title} lead={m.agents.lead}>
          <AgentSection />
        </Section>
        <Section title={m.prompts.title} lead={m.prompts.lead}>
          <PromptRow scope={{ type: 'general' }} layer="general" />
          <p className="mt-4 text-sm text-ink-muted">{m.prompts.forSubjects}</p>
        </Section>
        <Section title={m.settings.data.title} lead={m.settings.data.lead}>
          <EraseAll />
        </Section>
        <Section title={m.settings.access.title}>
          <ChangePasscode />
          <div className="mt-8">
            <Button
              variant="secondary"
              busy={leaving}
              onClick={() => {
                setLeaving(true);
                void logout();
              }}
            >
              {m.settings.access.logout}
            </Button>
          </div>
        </Section>
      </div>
    </Sheet>
  );
}
