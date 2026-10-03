/** Wartet auf eine abgelehnte Zusage und gibt den Fehler zurück. Schlägt fehl, wenn sie gelingt. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Abgelehnt, aber kein Error-Objekt.');
  }
  throw new Error('Erwartet wurde eine Ablehnung, die Zusage ist aber gelungen.');
}
