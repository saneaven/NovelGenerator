import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import './DropdownMenu.css';

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  trigger,
  children,
  align = 'right',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 160; // Approximate menu width
      const menuHeight = 200; // Approximate menu height
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Flip up if not enough space below but enough above
      const shouldFlipUp = spaceBelow < menuHeight && spaceAbove > menuHeight;

      setMenuPosition({
        top: shouldFlipUp
          ? rect.top + window.scrollY - menuHeight - 4
          : rect.bottom + window.scrollY + 4,
        left: align === 'right'
          ? rect.right + window.scrollX - menuWidth
          : rect.left + window.scrollX,
      });
    }
  }, [isOpen, align]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Close on scroll
  useEffect(() => {
    if (isOpen) {
      const handleScroll = () => setIsOpen(false);
      window.addEventListener('scroll', handleScroll, true);
      return () => window.removeEventListener('scroll', handleScroll, true);
    }
  }, [isOpen]);

  return (
    <div className="dropdown-container">
      <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)} className="dropdown-trigger">
        {trigger}
      </div>
      {isOpen && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className={`dropdown-menu portal ${align}`}
          style={{
            position: 'absolute',
            top: menuPosition.top,
            left: menuPosition.left,
            zIndex: 9999,
          }}
        >
          {React.Children.map(children, (child) => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as React.ReactElement<{ onClick?: () => void }>, {
                onClick: () => {
                  const originalOnClick = (child.props as { onClick?: () => void }).onClick;
                  if (originalOnClick) {
                    originalOnClick();
                  }
                  setIsOpen(false);
                },
              });
            }
            return child;
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

interface DropdownItemProps {
  icon?: string;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  className?: string;
}

export const DropdownItem: React.FC<DropdownItemProps> = ({
  icon,
  label,
  onClick,
  variant = 'default',
  disabled = false,
  className = '',
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  return (
    <button
      className={`dropdown-item ${variant} ${disabled ? 'disabled' : ''} ${className}`.trim()}
      onClick={handleClick}
      disabled={disabled}
    >
      {icon && <span className="dropdown-item-icon">{icon}</span>}
      <span className="dropdown-item-label">{label}</span>
    </button>
  );
};

interface DropdownDividerProps {
  className?: string;
}

export const DropdownDivider: React.FC<DropdownDividerProps> = ({ className = '' }) => {
  return <div className={`dropdown-divider ${className}`.trim()} />;
};
