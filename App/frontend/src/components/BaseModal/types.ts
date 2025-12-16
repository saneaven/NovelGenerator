import type { ReactNode } from 'react';

export type ModalSize = 'small' | 'medium' | 'large' | 'xlarge';

export interface BaseModalProps {
  /** Whether the modal is open */
  isOpen: boolean;

  /** Callback when modal should close */
  onClose: () => void;

  /** Modal title - renders in header */
  title?: ReactNode;

  /** Icon to display next to title */
  titleIcon?: ReactNode;

  /** Size preset for the modal */
  size?: ModalSize;

  /** Whether to show the header (default: true) */
  showHeader?: boolean;

  /** Custom className for the modal content */
  className?: string;

  /** Whether clicking overlay closes modal (default: true) */
  closeOnOverlayClick?: boolean;

  /** Whether pressing Escape closes modal (default: true) */
  closeOnEscape?: boolean;

  /** Z-index layer - for nested modal support (0-3) */
  zIndexLayer?: number;

  /** Whether to show the close button in header (default: true) */
  showCloseButton?: boolean;

  /** Footer content */
  footer?: ReactNode;

  /** Children content */
  children: ReactNode;
}

export const MODAL_SIZE_CONFIG: Record<ModalSize, { maxWidth: string; maxHeight: string }> = {
  small: { maxWidth: '500px', maxHeight: '80dvh' },
  medium: { maxWidth: '700px', maxHeight: '85dvh' },
  large: { maxWidth: '900px', maxHeight: '90dvh' },
  xlarge: { maxWidth: '1100px', maxHeight: '90dvh' },
};
