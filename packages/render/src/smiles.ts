import SmilesDrawer from 'smiles-drawer';
import { LIMITS, RenderError } from './errors';
import { checkSmilesValence } from './smiles-valence';

/**
 * `null`, wenn die SMILES-Zeichenkette gelesen werden kann und jedes Atom so viele Bindungen hat, wie die
 * Schulchemie erlaubt. Ohne DOM nutzbar (Server, Tests).
 */
export function validateSmiles(smiles: string): RenderError | null {
  const text = smiles.trim();
  if (text === '') return new RenderError('empty');
  if (text.length > LIMITS.mol) return new RenderError('too_large');
  try {
    SmilesDrawer.Parser.parse(text);
  } catch {
    return new RenderError('invalid_smiles');
  }
  return checkSmilesValence(text);
}
