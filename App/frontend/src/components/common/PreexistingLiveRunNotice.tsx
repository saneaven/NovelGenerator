import React from 'react';
import { useTranslation } from 'react-i18next';
import './PreexistingLiveRunNotice.css';

interface PreexistingLiveRunNoticeProps {
  className?: string;
  compact?: boolean;
}

const PreexistingLiveRunNotice: React.FC<PreexistingLiveRunNoticeProps> = ({
  className,
  compact = false,
}) => {
  const { t } = useTranslation();
  const classes = [
    'preexisting-live-run-notice',
    compact ? 'preexisting-live-run-notice--compact' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status">
      <div className="preexisting-live-run-notice__title">{t('streamRecovery.title')}</div>
      <div className="preexisting-live-run-notice__body">{t('streamRecovery.body')}</div>
    </div>
  );
};

export default PreexistingLiveRunNotice;
