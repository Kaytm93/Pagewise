import { useState } from 'react';
import type { Subject } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { sectionTitle } from '../../ui/styles';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { ModelDialog } from './ModelDialog';
import { describeSelection, engineName } from './models';

/** Zeile „Modell“ eines Fachs: zeigt, was gilt (Modell oder Agent), und lässt es ändern. */
export function SubjectModel({ subject }: { subject: Subject }) {
  const { providers, modelSettings, engines, setSubjectModel, setSubjectEngine } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ownEngine = engineName(engines.profiles, subject.engineProfileId);
  const own = describeSelection(providers, subject.model);
  const standard = describeSelection(providers, modelSettings.default);

  let summary: string;
  if (ownEngine) summary = format(m.subject.agentOwn, { name: ownEngine });
  else if (own) summary = format(m.subject.modelOwn, { name: own });
  else if (standard) summary = format(m.subject.modelDefault, { name: standard });
  else summary = m.subject.modelNone;

  return (
    <section className="mt-10 border-t border-line-warm pt-6" aria-labelledby="model-heading">
      <h2 id="model-heading" className={sectionTitle}>
        {m.subject.model}
      </h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="break-words">{summary}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{m.subject.modelLead}</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {m.subject.modelChange}
        </Button>
      </div>
      {open && (
        <ModelDialog
          title={m.chat.modelDialog.subjectTitle}
          lead={m.chat.modelDialog.subjectLead}
          value={{ model: subject.model, engineProfileId: subject.engineProfileId }}
          inheritLabel={m.chat.modelDialog.inheritSubject}
          inheritedName={standard}
          onSave={async (choice) => {
            if (choice.engineProfileId) await setSubjectEngine(subject.id, choice.engineProfileId);
            else if (choice.model) await setSubjectModel(subject.id, choice.model);
            else {
              // „Keine Wahl“ hebt beides auf, was gesetzt ist.
              if (subject.engineProfileId) await setSubjectEngine(subject.id, null);
              if (subject.model) await setSubjectModel(subject.id, null);
            }
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
