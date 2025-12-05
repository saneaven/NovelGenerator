import React from 'react';
import './ToastProgressBar.css';

interface ToastProgressBarProps {
  current: number;
  total: number;
}

const ToastProgressBar: React.FC<ToastProgressBarProps> = ({ current, total }) => {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="toast-progress-bar">
      <div
        className="toast-progress-bar-fill"
        style={{ width: `${percentage}%` }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
      />
    </div>
  );
};

export default ToastProgressBar;
