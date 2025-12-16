import type { ReactNode } from 'react';

export type SidebarPosition = 'left' | 'right';
export type SidebarId = 'chat' | 'chapter' | string;

export interface BaseSidebarProps {
  /** Unique identifier for this sidebar */
  id: SidebarId;

  /** Project ID for per-project state management */
  projectId: string;

  /** Slide direction - determines which side the sidebar appears from */
  position: SidebarPosition;

  /** Custom CSS class name for additional styling */
  className?: string;

  /** Content to render inside the sidebar */
  children: ReactNode;

  /** Callback when sidebar is closed (backdrop click, escape key) */
  onClose?: () => void;

  /** Optional header component rendered at the top */
  header?: ReactNode;

  /** Close on escape key press. Default: true */
  closeOnEscape?: boolean;

  /** Custom z-index override */
  zIndex?: number;
}
