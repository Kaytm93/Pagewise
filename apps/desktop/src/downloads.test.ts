import { describe, expect, it } from 'vitest';
import { safeDownloadName, uniqueDownloadPath } from './downloads';

describe('Downloads', () => {
  it('macht aus jedem Namen einen sicheren Dateinamen', () => {
    expect(safeDownloadName('Arbeitsblatt.pdf')).toBe('Arbeitsblatt.pdf');
    expect(safeDownloadName('../../etc/passwd')).toBe('passwd');
    expect(safeDownloadName('..\\..\\Windows\\x.exe')).toBe('x.exe');
    expect(safeDownloadName('.bashrc')).toBe('bashrc');
    expect(safeDownloadName('a:b*c?"d<e>f|g.txt')).toBe('a_b_c__d_e_f_g.txt');
    expect(safeDownloadName('bös\u0000e\nname.pdf')).toBe('bös_e_name.pdf');
    expect(safeDownloadName('')).toBe('Download');
    expect(safeDownloadName('...')).toBe('Download');
    expect(safeDownloadName('/')).toBe('Download');
    expect(safeDownloadName(`${'x'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(120);
  });

  it('hängt bei vorhandenem Namen eine Nummer vor die Endung', () => {
    const taken = new Set(['/Downloads/Plan.pptx', '/Downloads/Plan (1).pptx']);
    const exists = (path: string) => taken.has(path);
    expect(uniqueDownloadPath('/Downloads', 'Neu.pdf', exists)).toBe('/Downloads/Neu.pdf');
    expect(uniqueDownloadPath('/Downloads', 'Plan.pptx', exists)).toBe('/Downloads/Plan (2).pptx');
  });

  it('bleibt im Ordner, auch bei bösem Namen', () => {
    expect(uniqueDownloadPath('/Downloads', '../../x.sh', () => false)).toBe('/Downloads/x.sh');
  });

  it('gibt nach tausend Versuchen auf, statt endlos zu suchen', () => {
    const path = uniqueDownloadPath('/D', 'a.txt', () => true);
    expect(path).toBe('/D/a (999).txt');
  });
});
