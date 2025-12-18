import React from 'react';
import './NotificationProgressBar.css';

interface NotificationProgressBarProps {
  current: number;
  total: number;
}

const NotificationProgressBar: React.FC<NotificationProgressBarProps> = ({ current, total }) => {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="notification-progress-bar">
      <div
        className="notification-progress-bar-fill"
        style={{ width: `${percentage}%` }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
      />
    </div>
  );
};

export default NotificationProgressBar;
