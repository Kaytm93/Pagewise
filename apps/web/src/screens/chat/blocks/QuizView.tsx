import { parseQuizSpec, type QuizSpec } from '@pagewise/render/quiz';
import { Check, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { format, messages as m } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { BlockError } from './BlockView';

/**
 * Quiz im Chat: Antworten wählen, „Prüfen“ wertet alles lokal aus. Kein Netz, nichts wird gespeichert: Die Wahl
 * lebt nur in dieser Ansicht. Ändert sich der Block noch (während des Schreibens), beginnt das Quiz neu.
 */
export default function QuizView({ source, final }: { source: string; final: boolean }) {
  const parsed = useMemo(() => parseQuizSpec(source), [source]);
  if (!parsed.ok) {
    return (
      <BlockError label={m.blocks.quiz} code={parsed.error.code} source={source} final={final} />
    );
  }
  return <Quiz key={source} spec={parsed.value} />;
}

function Quiz({ spec }: { spec: QuizSpec }) {
  const id = useId();
  const [picks, setPicks] = useState<(number | null)[]>(() => spec.questions.map(() => null));
  const [checked, setChecked] = useState(false);
  const scoreRef = useRef<HTMLParagraphElement>(null);
  const total = spec.questions.length;
  const answered = picks.filter((pick) => pick !== null).length;
  const correct = spec.questions.filter((item, q) => picks[q] === item.answer).length;

  // Nach „Prüfen“ landet der Fokus beim Ergebnis, damit Tastatur und Vorleser es sofort finden.
  useEffect(() => {
    if (checked) scoreRef.current?.focus();
  }, [checked]);

  const choose = (question: number, option: number) =>
    setPicks((current) => current.map((pick, q) => (q === question ? option : pick)));

  const restart = () => {
    setPicks(spec.questions.map(() => null));
    setChecked(false);
  };

  return (
    <section
      aria-label={spec.title ?? m.blocks.quiz}
      className="pg-quiz my-4 rounded-box bg-paper p-4"
    >
      {spec.title && <p className="font-heading text-base font-medium text-ink">{spec.title}</p>}
      <ol className="m-0 list-none space-y-6 p-0">
        {spec.questions.map((item, q) => {
          const pick = picks[q] ?? null;
          const group = `${id}-${q}`;
          return (
            <li key={group} className="mt-5 first:mt-0">
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2 p-0 text-ink">
                  <span className="block text-sm text-ink-muted">
                    {format(m.blocks.quizView.questionOf, { n: q + 1, total })}
                  </span>
                  <span className="font-medium">{item.question}</span>
                </legend>
                <div className="flex flex-col gap-2">
                  {item.options.map((option, o) => {
                    const isRight = o === item.answer;
                    const isPick = pick === o;
                    const edge =
                      checked && isRight
                        ? 'border-accent'
                        : checked && isPick
                          ? 'border-danger'
                          : 'border-control-edge';
                    return (
                      <label
                        key={option}
                        className={`mo-press flex min-h-11 cursor-pointer items-center gap-3 rounded-control border bg-canvas px-3 py-2 text-ink has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent ${edge}`}
                      >
                        <input
                          type="radio"
                          name={group}
                          value={o}
                          checked={isPick}
                          disabled={checked}
                          onChange={() => choose(q, o)}
                          className="m-0 size-5 shrink-0 accent-accent"
                        />
                        <span className="min-w-0 flex-1 break-words">{option}</span>
                        {checked && (isRight || isPick) && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium">
                            {isRight ? (
                              <Check aria-hidden="true" className="size-4" />
                            ) : (
                              <X aria-hidden="true" className="size-4" />
                            )}
                            {isRight ? m.blocks.quizView.right : m.blocks.quizView.yourAnswer}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {checked && (
                <div className="mt-2 text-sm">
                  {pick === null ? (
                    <p className="text-ink-secondary">
                      {m.blocks.quizView.unanswered}{' '}
                      {format(m.blocks.quizView.rightAnswer, {
                        answer: item.options[item.answer] ?? '',
                      })}
                    </p>
                  ) : pick === item.answer ? (
                    <p className="font-medium text-ink">{m.blocks.quizView.right}</p>
                  ) : (
                    <p className="font-medium text-danger">
                      {m.blocks.quizView.wrong}{' '}
                      {format(m.blocks.quizView.rightAnswer, {
                        answer: item.options[item.answer] ?? '',
                      })}
                    </p>
                  )}
                  {item.explanation && (
                    <p className="mt-1 text-ink-secondary">
                      {format(m.blocks.quizView.explanation, { text: item.explanation })}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {checked ? (
          <Button variant="secondary" onClick={restart}>
            {m.blocks.quizView.again}
          </Button>
        ) : (
          <Button variant="primary" disabled={answered === 0} onClick={() => setChecked(true)}>
            {m.blocks.quizView.check}
          </Button>
        )}
        <p ref={scoreRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">
          {checked
            ? format(m.blocks.quizView.score, { correct, total })
            : answered === 0
              ? m.blocks.quizView.pickFirst
              : ''}
        </p>
      </div>
    </section>
  );
}
