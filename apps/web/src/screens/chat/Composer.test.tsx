// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

describe('Composer: Dateiimport', () => {
  it('zeigt beigelegte Dateien, entfernt sie wieder und sendet sie mit dem Text', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => true);
    const onStop = vi.fn();
    const { container } = render(
      <Composer
        chatId="chat-1"
        disabled={false}
        running={false}
        stopping={false}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    const chooser = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(chooser).not.toBeNull();

    const file = new File(['Beispielinhalt'], 'beispiel.png', { type: 'image/png' });
    await user.upload(chooser, file);

    // Die Datei erscheint als Chips mit Entfernen-Knopf.
    expect(screen.getByText('beispiel.png')).not.toBeNull();
    const send = screen.getByRole('button', { name: 'Senden' }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    // Senden mit Text: die Datei reist mit.
    await user.type(screen.getByLabelText('Nachricht'), 'Was ist darauf?');
    await user.click(send);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith('Was ist darauf?', [file]);

    // Nach dem Senden ist die Liste geleert.
    await waitFor(() => expect(screen.queryByText('beispiel.png')).toBeNull());
  });

  it('mehr als vier Dateien werden abgewiesen, zu große Dateien mit Namen gemeldet', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => true);
    const { container } = render(
      <Composer
        chatId="chat-2"
        disabled={false}
        running={false}
        stopping={false}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    const chooser = container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from(
      { length: 6 },
      (_, index) => new File(['x'], `datei-${index}.txt`, { type: 'text/plain' }),
    );
    await user.upload(chooser, files);
    expect(screen.getByText('Höchstens 4 Dateien je Nachricht.')).not.toBeNull();
    // Nur vier bleiben in der Liste.
    expect(screen.getAllByRole('button', { name: /wieder entfernen/ })).toHaveLength(4);

    const riesig = new File([new ArrayBuffer(26 * 1024 * 1024)], 'riesig.png', {
      type: 'image/png',
    });
    await user.upload(chooser, [riesig]);
    await screen.findByText(/„riesig.png“ ist zu groß/);
  });

  it('ohne Text und ohne Dateien bleibt der Sendeknopf aus', async () => {
    const { container } = render(
      <Composer
        chatId="chat-3"
        disabled={false}
        running={false}
        stopping={false}
        onSend={vi.fn()}
        onStop={() => {}}
      />,
    );
    const send = screen.getByRole('button', { name: 'Senden' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // Mit einer Datei allein ist Senden möglich (Text darf leer sein).
    const chooser = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(chooser, [new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect((screen.getByRole('button', { name: 'Senden' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
