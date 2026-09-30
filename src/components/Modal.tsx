import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Confirmation dialog, rendered while open: a modal <dialog> like DesignControls' (focus moves in and stays, Esc cancels). */
export default function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Layout effect: its cleanup runs while the dialog is still attached, so close() returns focus to the opener.
  useLayoutEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={dialog} className="modal design-dialog" aria-labelledby={labelledBy} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
