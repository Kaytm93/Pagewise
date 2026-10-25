import { messages as m } from '../i18n';
import { Button } from './Button';
import { Modal, ModalFooter } from './modal';

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
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} data-autofocus>
          {m.common.cancel}
        </Button>
        <Button variant="primary" busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
