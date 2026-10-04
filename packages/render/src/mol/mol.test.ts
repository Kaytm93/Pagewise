import { describe, expect, it } from 'vitest';
import { RenderError } from '../errors';
import {
  KNOWN_FORMULAS,
  MOLECULES,
  parseMolSpec,
  renderFormula,
  validateFormulaSpec,
  withSubscripts,
} from './index';

const spec = (source: string) => {
  const result = parseMolSpec(source);
  if (!result.ok) throw result.error;
  return result.value;
};

const count = (svg: string, pattern: RegExp) => (svg.match(pattern) ?? []).length;

describe('Angabe', () => {
  it('liest die Kurzform und löst Tiefstellung und Schreibweise auf', () => {
    expect(spec('H2O')).toMatchObject({ kind: 'formula', value: 'H2O' });
    expect(spec('H₂O').value).toBe('H2O');
    expect(spec('h2o').value).toBe('h2o');
    expect(spec(' CO_2 ').value).toBe('CO2');
  });

  it('liest Schlüssel auf Deutsch und Englisch', () => {
    expect(
      spec('formel: NH3\nbeschriftung: Ammoniak\nwinkel: nein\nelektronenpaare: aus'),
    ).toMatchObject({
      value: 'NH3',
      caption: 'Ammoniak',
      angles: false,
      lonePairs: false,
    });
    expect(spec('smiles: CCO')).toMatchObject({ kind: 'smiles', value: 'CCO' });
    expect(spec('formula: CH4\ncaption: aus').caption).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['formel: H2O\nsmiles: CCO', 'invalid_spec'],
    ['unbekannt: x', 'invalid_spec'],
    ['formel: H2O\nwinkel: vielleicht', 'invalid_spec'],
    ['zwei\nzeilen', 'invalid_spec'],
    ['formel:', 'invalid_spec'],
    ['formel: H2\u0001O', 'invalid_spec'],
  ])('lehnt %j mit %s ab', (source, code) => {
    const result = parseMolSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('begrenzt die Größe', () => {
    expect(parseMolSpec(`smiles: ${'C'.repeat(2000)}`)).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    });
  });
});

describe('Zeichnung der Schulmoleküle', () => {
  it('kennt die Tabelle und zeichnet jede Formel ohne Fehler und ohne ungültige Zahlen', () => {
    expect(KNOWN_FORMULAS.length).toBeGreaterThanOrEqual(15);
    for (const formula of KNOWN_FORMULAS) {
      const svg = renderFormula(spec(formula));
      expect(svg.startsWith('<svg'), formula).toBe(true);
      expect(svg, formula).not.toMatch(/NaN|Infinity|undefined|<style|<script|style=|href=/);
    }
  });

  it('Wasser: ein Sauerstoff, zwei Wasserstoff, zwei Striche für freie Paare, Winkel 104,5°', () => {
    const svg = renderFormula(spec('H2O'));
    expect(count(svg, />O</g)).toBe(1);
    expect(count(svg, />H</g)).toBe(2);
    expect(count(svg, /class="pg-lp"/g)).toBe(2);
    expect(count(svg, /class="pg-bond"/g)).toBe(2);
    expect(svg).toContain('104,5°');
    expect(svg).toContain('>H₂O<');
  });

  it('Kohlenstoffdioxid: zwei Doppelbindungen (vier Striche), vier freie Paare', () => {
    const svg = renderFormula(spec('CO2'));
    expect(count(svg, /class="pg-bond"/g)).toBe(4);
    expect(count(svg, /class="pg-lp"/g)).toBe(4);
  });

  it('Stickstoff: Dreifachbindung (drei Striche), je ein freies Paar', () => {
    const svg = renderFormula(spec('N2'));
    expect(count(svg, /class="pg-bond"/g)).toBe(3);
    expect(count(svg, /class="pg-lp"/g)).toBe(2);
  });

  it('Methan: vier Wasserstoffe, ein Keil und eine gestrichelte Bindung (sechs Striche)', () => {
    const svg = renderFormula(spec('CH4'));
    expect(count(svg, />H</g)).toBe(4);
    expect(count(svg, /class="pg-wedge"/g)).toBe(1);
    expect(count(svg, /class="pg-dash"/g)).toBe(6);
  });

  it('Ammoniak: ein freies Paar am Stickstoff', () => {
    expect(count(renderFormula(spec('NH3')), /class="pg-lp"/g)).toBe(1);
  });

  it('lässt Elektronenpaare, Winkel und Beschriftung auf Wunsch weg', () => {
    const svg = renderFormula(
      spec('formel: H2O\nelektronenpaare: nein\nwinkel: nein\nbeschriftung: aus'),
    );
    expect(svg).not.toContain('pg-lp');
    expect(svg).not.toContain('104,5');
    expect(svg).not.toContain('pg-caption');
  });

  it('setzt eine eigene Beschriftung als Text, nie als Markup', () => {
    const svg = renderFormula(spec('formel: H2O\nbeschriftung: <b>Wasser</b>'));
    expect(svg).toContain('&#60;b&#62;Wasser&#60;/b&#62;');
    expect(svg).not.toContain('<b>');
  });

  it('findet Formeln auch ohne Groß- und Kleinschreibung', () => {
    expect(renderFormula(spec('h2o'))).toBe(renderFormula(spec('H2O')).replace('>H₂O<', '>h₂o<'));
    expect(renderFormula(spec('co2'))).toContain('pg-bond');
  });

  it('ist deterministisch', () => {
    expect(renderFormula(spec('SO2'))).toBe(renderFormula(spec('SO2')));
  });

  it('Elektronenpaare liegen nicht auf Bindungen (Winkel der Paare weichen von denen der Bindungen ab)', () => {
    for (const [formula, molecule] of Object.entries(MOLECULES)) {
      for (const [index, atom] of molecule.atoms.entries()) {
        const bondAngles = molecule.bonds
          .filter((bond) => bond.a === index || bond.b === index)
          .map((bond) => {
            const other = molecule.atoms[bond.a === index ? bond.b : bond.a];
            if (!other) return 0;
            return (Math.atan2(other.y - atom.y, other.x - atom.x) * 180) / Math.PI;
          });
        for (const lp of atom.lp) {
          for (const bondAngle of bondAngles) {
            const diff = Math.abs(((lp - bondAngle + 540) % 360) - 180);
            expect(diff > 20, `${formula}: Paar bei ${lp}° liegt auf einer Bindung`).toBe(true);
          }
        }
      }
    }
  });
});

describe('Unbekannte Formeln', () => {
  it('nennen die Formel (nur Buchstaben und Ziffern) und den Code', () => {
    expect(() => renderFormula(spec('C8H18'))).toThrowError(
      expect.objectContaining({ code: 'unknown_formula', detail: 'C8H18' }),
    );
    const bad = validateFormulaSpec(spec('formel: <img onerror=x>'));
    expect(bad).toBeInstanceOf(RenderError);
    expect(bad?.detail).toBe('imgonerrorx');
    expect(bad?.detail).not.toMatch(/[<>=]/);
  });

  it('kennen keine Namen aus dem Prototyp', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(validateFormulaSpec(spec(name))?.code).toBe('unknown_formula');
    }
  });

  it('SMILES-Angaben prüft ein anderer Weg', () => {
    expect(validateFormulaSpec(spec('smiles: CCO'))).toBeNull();
  });
});

describe('withSubscripts', () => {
  it('stellt Ziffern nach Buchstaben tief', () => {
    expect(withSubscripts('H2O')).toBe('H₂O');
    expect(withSubscripts('C2H5OH')).toBe('C₂H₅OH');
    expect(withSubscripts('Ca(OH)2')).toBe('Ca(OH)₂');
    expect(withSubscripts('2 H2O')).toBe('2 H₂O');
  });
});
