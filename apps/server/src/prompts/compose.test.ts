import { describe, expect, it } from 'vitest';
import {
  composePrompt,
  fillPlaceholders,
  NOT_SPECIFIED,
  type PlaceholderValues,
  TECHNICAL_LAYER,
} from './compose';

const values: PlaceholderValues = {
  bundesland: 'Beispielland',
  schulform: 'Beispielschule',
  jahrgangsstufe: '11',
  fach: 'Beispielfach A',
  untergruppe: 'Beispiel-Thema',
};

describe('fillPlaceholders', () => {
  it('setzt alle bekannten Variablen ein, auch mehrfach und mit Leerzeichen in den Klammern', () => {
    const result = fillPlaceholders(
      '{{fach}} / {{ untergruppe }} / {{fach}} ({{jahrgangsstufe}})',
      values,
    );
    expect(result.text).toBe('Beispielfach A / Beispiel-Thema / Beispielfach A (11)');
    expect(result.missing).toEqual([]);
  });

  it('ersetzt fehlende Werte sichtbar und meldet sie einmal', () => {
    const result = fillPlaceholders('{{bundesland}} {{bundesland}} {{fach}}', {
      ...values,
      bundesland: null,
    });
    expect(result.text).toBe(`${NOT_SPECIFIED} ${NOT_SPECIFIED} Beispielfach A`);
    expect(result.missing).toEqual(['bundesland']);
  });

  it('behandelt einen leeren Wert wie einen fehlenden', () => {
    expect(fillPlaceholders('{{fach}}', { ...values, fach: '' }).text).toBe(NOT_SPECIFIED);
  });

  it('lässt unbekannte Namen und andere Klammern unverändert', () => {
    const text = [
      '{{unbekannt}}',
      '{{FACH}}',
      '{fach}',
      '{{ fach }',
      '{{fach.name}}',
      '$',
      '{fach}',
    ].join(' ');
    expect(fillPlaceholders(text, values).text).toBe(text);
  });

  it('wertet eingesetzte Werte nicht erneut aus', () => {
    const result = fillPlaceholders('{{fach}} und {{untergruppe}}', {
      ...values,
      fach: '{{untergruppe}}',
    });
    expect(result.text).toBe('{{untergruppe}} und Beispiel-Thema');
  });

  it('behandelt Sonderzeichen in Werten als Text', () => {
    const result = fillPlaceholders('A {{fach}} B', { ...values, fach: "$& $1 $` $' $$" });
    expect(result.text).toBe("A $& $1 $` $' $$ B");
  });
});

describe('composePrompt', () => {
  const empty = { general: null, subject: null, group: null };

  it('besteht ohne Nutzertext nur aus der technischen Schicht', () => {
    const result = composePrompt(empty, values);
    expect(result.system).toBe(TECHNICAL_LAYER);
    expect(result.layers).toEqual([{ layer: 0, text: TECHNICAL_LAYER }]);
  });

  it('enthält keine Schulinhalte und keine Variablen in der technischen Schicht', () => {
    expect(TECHNICAL_LAYER).not.toMatch(/\{\{/);
    expect(TECHNICAL_LAYER.length).toBeLessThan(400);
  });

  it('setzt die Schichten in der Reihenfolge 0, 1, 2, 3 zusammen', () => {
    const result = composePrompt(
      {
        general: 'Allgemein {{jahrgangsstufe}}',
        subject: 'Fach {{fach}}',
        group: 'Thema {{untergruppe}}',
      },
      values,
    );
    expect(result.layers.map((entry) => entry.layer)).toEqual([0, 1, 2, 3]);
    expect(result.system).toBe(
      [TECHNICAL_LAYER, 'Allgemein 11', 'Fach Beispielfach A', 'Thema Beispiel-Thema'].join('\n\n'),
    );
  });

  it('lässt leere und nur aus Leerraum bestehende Schichten weg', () => {
    const result = composePrompt({ general: '   \n', subject: 'Nur Fach', group: '' }, values);
    expect(result.layers.map((entry) => entry.layer)).toEqual([0, 2]);
  });

  it('sammelt fehlende Variablen über alle Schichten, in fester Reihenfolge', () => {
    const result = composePrompt(
      { general: '{{schulform}}', subject: '{{bundesland}} {{fach}}', group: '{{untergruppe}}' },
      { ...values, schulform: null, bundesland: null, untergruppe: null },
    );
    expect(result.missing).toEqual(['bundesland', 'schulform', 'untergruppe']);
  });
});
