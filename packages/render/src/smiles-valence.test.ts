import { describe, expect, it } from 'vitest';
import { validateSmiles } from './smiles';
import { checkSmilesValence } from './smiles-valence';

/** Code und Detail des Befunds, oder `null`, wenn die Angabe in Ordnung ist. */
const finding = (smiles: string) => {
  const error = checkSmilesValence(smiles);
  return error ? [error.code, error.detail] : null;
};

describe('checkSmilesValence', () => {
  it('lässt Schulmoleküle, Ionen, Ringe und Stereoangaben durch', () => {
    const good = [
      'C',
      'CCO',
      'C=C',
      'C#N',
      'O=C=O',
      'CC(=O)O',
      'CC(C)(C)C',
      'CS(=O)(=O)C',
      'FC(F)(F)F',
      'N#N',
      'C1CCCCC1',
      'C1=CC=CC=C1',
      'C1CC1',
      'C%10CC%10',
      'F/C=C/F',
      'C[C@H](N)C(=O)O',
      '[NH4+]',
      '[O-]S(=O)(=O)[O-]',
      '[H][H]',
      '[CH3]',
      '[13CH4]',
      'C(=O)[O-].[Na+]',
    ];
    for (const smiles of good) expect(finding(smiles), smiles).toBeNull();
  });

  it('nennt das erste Atom mit zu vielen Bindungen (ab 1, in der Reihenfolge der Angabe)', () => {
    expect(finding('C(C)(C)(C)(C)C')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('CC(C)(C)(C)C')).toEqual(['invalid_valence', 'Atom 2']);
    expect(finding('FC(F)(F)(F)F')).toEqual(['invalid_valence', 'Atom 2']);
    expect(finding('CN(=O)=O')).toEqual(['invalid_valence', 'Atom 2']);
    expect(finding('N(C)(C)(C)C')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('O(C)(C)C')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('F(F)F')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('CCO.C(C)(C)(C)(C)C')).toEqual(['invalid_valence', 'Atom 4']);
  });

  it('zählt Wasserstoffe in eckigen Klammern mit', () => {
    expect(finding('[CH5]')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('[NH4]')).toEqual(['invalid_valence', 'Atom 1']);
    expect(finding('[NH4+]')).toBeNull();
  });

  it('meldet eine Angabe, die sich nicht zerlegen lässt, als Schreibfehler', () => {
    expect(finding('C1CC')).toEqual(['invalid_smiles', undefined]);
    expect(finding('C(C')).toEqual(['invalid_smiles', undefined]);
    expect(finding('C=')).toEqual(['invalid_smiles', undefined]);
  });

  it('übergeht aromatische Atome und Ladungen', () => {
    expect(finding('c1ccccc1O')).toBeNull();
    expect(finding('c1cc(C)cc(C)c1')).toBeNull();
  });
});

describe('validateSmiles', () => {
  it('prüft die Bindungen nach der Schreibweise, also auch beim Zeichnen', () => {
    expect(validateSmiles('CCO')).toBeNull();
    expect(validateSmiles('C(C)(C)(C)(C)C')?.code).toBe('invalid_valence');
    expect(validateSmiles('C1CC')?.code).toBe('invalid_smiles');
    expect(validateSmiles('C(C')?.code).toBe('invalid_smiles');
  });
});
