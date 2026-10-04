import SmilesDrawer from 'smiles-drawer';
import { LIMITS, RenderError } from './errors';

/** `null`, wenn die SMILES-Zeichenkette gelesen werden kann. Ohne DOM nutzbar (Server, Tests). */
export function validateSmiles(smiles: string): RenderError | null {
  const text = smiles.trim();
  if (text === '') return new RenderError('empty');
  if (text.length > LIMITS.mol) return new RenderError('too_large');
  try {
    SmilesDrawer.Parser.parse(text);
    return null;
  } catch {
    return new RenderError('invalid_smiles');
  }
}
