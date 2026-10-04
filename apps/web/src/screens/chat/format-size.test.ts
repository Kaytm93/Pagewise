import { describe, expect, it } from 'vitest';
import { formatSize } from './format-size';

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [49_152, '48 KB'],
    [1536, '1,5 KB'],
    [3.2 * 1024 * 1024, '3,2 MB'],
    [-5, '0 B'],
  ])('%d Byte als %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});
