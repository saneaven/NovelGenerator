import React from 'react';
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
    ...restHandleProps
  } = handleProps || {};

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
      className={mergedClassName}
      data-disabled={disabled ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className="drag-handle__indicator" />
    </div>
  );
};

export default DragHandle;
