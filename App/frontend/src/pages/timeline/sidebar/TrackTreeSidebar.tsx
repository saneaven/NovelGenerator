import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { IconButton } from '../../../components/IconButton';
import { Close } from '../../../components/icons';
import { useSidebarStore } from '../../../store/sidebarStore';
import TrackTreeContent, { type TrackTreeContentProps } from './TrackTreeContent';

/**
 * Mobile drawer host: the standard workspace sidebar (hamburger-toggled).
 * Mount this only on mobile so a stale open state can never overlay desktop.
 */
const TrackTreeSidebar: React.FC<TrackTreeContentProps> = (props) => {
  const { t } = useTranslation();
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const handleClose = () => closeSidebar(props.projectId);

  return (
    <BaseSidebar
      id="timeline"
      projectId={props.projectId}
      position="right"
      className="tl-tree-sidebar"
      header={
        <div className="tl-tree-sidebar__header">
          <h3 className="header-title">{t('timeline.tree.title')}</h3>
          <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title={t('common.close')}
            size="sm"
            variant="ghost"
          />
        </div>
      }
      onClose={handleClose}
    >
      <TrackTreeContent {...props} onAfterStreamAction={handleClose} />
    </BaseSidebar>
  );
};

export default TrackTreeSidebar;
