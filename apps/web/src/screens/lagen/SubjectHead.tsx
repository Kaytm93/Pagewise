import { Pencil } from 'lucide-react';
import type { Group, Subject } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { describeSelection } from '../chat/models';

/**
 * Kopf der Fachseite in der Richtung „Lagen“ (M1-T2): Kicker, Name, Klebeband und Fachmotiv wie im
 * Entwurf, darunter die Zeilen zu Modell, Stunden, Untergruppen und Lehrkraft. Der Modell-Chip führt
 * zum vorhandenen Modell-Abschnitt; ein eigenes Menü gibt es hier nicht.
 */
export function SubjectHead({
  subject,
  group,
  onEdit,
}: {
  subject: Subject;
  group?: Group;
  onEdit: () => void;
}) {
  const { providers } = useWorkspace();
  const builtin = subject.kind === 'default';
  const editable = Boolean(group) || !builtin;
  const ownModel = describeSelection(providers, subject.model) ?? subject.model?.model ?? null;

  const modelInhalt = (
    <>
      <span aria-hidden="true" className="lg-dot" data-state={subject.model ? 'own' : 'default'} />
      <span>{ownModel ?? m.subject.modelStandard}</span>
    </>
  );

  return (
    <header className="relative mt-6 pt-7">
      <span aria-hidden="true" className="lg-tape top-1 left-0 [--r:-1.8deg]" />
      {!builtin && (
        <SubjectIcon
          icon={subject.icon}
          strokeWidth={0.4}
          className="lg-motif top-0 right-0 size-[84px] opacity-80 md:size-[132px]"
        />
      )}
      <div className="relative pr-[88px] md:pr-40">
        <p className="lg-kicker mo-rise">
          {group ? m.subject.kickerGroup : m.subject.kickerSubject}
        </p>
        <h1
          lang="de"
          className="mo-rise mo-i-1 font-heading hyphens-auto text-[length:var(--subject-h1)] leading-none tracking-[-0.035em] text-balance break-words"
        >
          {group ? group.name : subject.name}
        </h1>
      </div>

      <dl className="lg-meta-rows mo-rise mo-i-2">
        <dt>{m.subject.model}</dt>
        <dd>
          {group ? (
            <span className="lg-chip">{modelInhalt}</span>
          ) : (
            <a className="lg-chip" href="#model-heading">
              {modelInhalt}
            </a>
          )}
        </dd>

        {!builtin && (
          <>
            <dt>{m.subject.hours}</dt>
            <dd>
              {subject.hoursPerWeek === null ? (
                <span className="lg-meta-quiet">{m.subject.metaUnknown}</span>
              ) : (
                format(m.common.hoursPerWeek, { count: subject.hoursPerWeek })
              )}
            </dd>
          </>
        )}

        <dt>{m.subject.groups}</dt>
        <dd className="lg-meta-number">{subject.groups.length}</dd>

        {!builtin && subject.teacher && (
          <>
            <dt>{m.subject.teacher}</dt>
            <dd className="break-words">{subject.teacher}</dd>
          </>
        )}
      </dl>

      {editable && (
        <Button variant="secondary" className="mt-5" onClick={onEdit}>
          <Pencil aria-hidden="true" className="size-4" />
          {m.common.edit}
        </Button>
      )}
    </header>
  );
}
