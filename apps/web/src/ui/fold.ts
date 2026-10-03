/**
 * Vergleichsform für Namen und Suche, gleich wie auf dem Server (`foldName`): klein geschrieben,
 * Umlaute und ß als ae, oe, ue, ss, übrige Akzente entfernt. So findet „franzoesisch“ den Eintrag
 * „Französisch“ und umgekehrt.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
