/** Erkennt einen Verstoß gegen einen Unique-Index, egal ob direkt oder als Ursache gemeldet. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown): unknown =>
    typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return code(error) === 'SQLITE_CONSTRAINT_UNIQUE' || code(cause) === 'SQLITE_CONSTRAINT_UNIQUE';
}
