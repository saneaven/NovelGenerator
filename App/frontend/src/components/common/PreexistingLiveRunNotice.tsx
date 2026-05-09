import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loading } from './Loading';
import './PreexistingLiveRunNotice.css';

interface PreexistingLiveRunNoticeProps {
  className?: string;
}

const PreexistingLiveRunNotice: React.FC<PreexistingLiveRunNoticeProps> = ({
  className,
}) => {
  const { t } = useTranslation();
  const classes = [
    'preexisting-live-run-notice',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status">
      <div className="preexisting-live-run-notice__header">
        <Loading size="xs" variant="spinner" />
        <div className="preexisting-live-run-notice__title">{t('streamRecovery.title')}</div>
      </div>
      <div className="preexisting-live-run-notice__body">{t('streamRecovery.body')}</div>
    </div>
  );
};

export default PreexistingLiveRunNotice;
