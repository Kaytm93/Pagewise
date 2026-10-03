import { messages as m } from '../i18n';
import { Button } from './Button';
import { Modal } from './modal';

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bestätigung für Löschen und anderes, das sich nicht rückgängig machen lässt. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title={title} description={description} onClose={onCancel}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} data-autofocus>
          {m.common.cancel}
        </Button>
        <Button variant="primary" busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
