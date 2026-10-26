/**
 * Entfernt Markup und Steuerzeichen aus Treffertexten und kürzt sie. Der Text bleibt Daten; hier wird nichts
 * ausgeführt oder interpretiert.
 */
export function cleanText(value: string, max: number): string {
  const printable = Array.from(value.replace(/<[^>]*>/g, ' '), (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');
  const plain = printable.replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
