import React, { useCallback, useRef } from 'react';
import './DragHandle.css';

export type DragHandleOrientation = 'horizontal' | 'vertical';

interface DragHandleProps {
  orientation: DragHandleOrientation;
  disabled?: boolean;
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
}

const DragHandle: React.FC<DragHandleProps> = ({
  orientation,
  disabled = false,
  handleProps,
  className,
}) => {
  const {
    className: handleClassName,
    onClick,
    onTouchStart: externalTouchStart,
    onTouchEnd: externalTouchEnd,
    onTouchCancel: externalTouchCancel,
    onTouchMove: externalTouchMove,
    ...restHandleProps
  } = (handleProps || {}) as React.HTMLAttributes<HTMLDivElement>;

  const ref = useRef<HTMLDivElement>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const clearPending = useCallback(() => {
    touchStartPos.current = null;
    ref.current?.classList.remove('is-touch-pending');
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!disabled) {
        const touch = e.touches[0];
        touchStartPos.current = { x: touch.clientX, y: touch.clientY };
        ref.current?.classList.add('is-touch-pending');
      }
      (externalTouchStart as React.TouchEventHandler<HTMLDivElement>)?.(e);
    },
    [disabled, externalTouchStart]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      clearPending();
      (externalTouchEnd as React.TouchEventHandler<HTMLDivElement>)?.(e);
    },
    [clearPending, externalTouchEnd]
  );

  const handleTouchCancel = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      clearPending();
      (externalTouchCancel as React.TouchEventHandler<HTMLDivElement>)?.(e);
    },
    [clearPending, externalTouchCancel]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (touchStartPos.current) {
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartPos.current.x;
        const dy = touch.clientY - touchStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) {
          clearPending();
        }
      }
      (externalTouchMove as React.TouchEventHandler<HTMLDivElement>)?.(e);
    },
    [clearPending, externalTouchMove]
  );

  const mergedClassName = [
    'drag-handle',
    `drag-handle--${orientation}`,
    disabled ? 'is-disabled' : '',
    handleClassName || '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <div
      {...restHandleProps}
      ref={ref}
      className={mergedClassName}
      data-disabled={disabled ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onTouchMove={handleTouchMove}
    >
      <span className="drag-handle__indicator" />
    </div>
  );
};

export default DragHandle;
