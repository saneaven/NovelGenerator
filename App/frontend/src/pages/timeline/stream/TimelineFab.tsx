import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from '../../../components/icons';

interface TimelineFabProps {
  onClick: () => void;
}

/** Mobile floating create button, clearing the MobileFooter. */
const TimelineFab: React.FC<TimelineFabProps> = ({ onClick }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="tl-fab"
      onClick={onClick}
      aria-label={t('timeline.fab.addEvent')}
      title={t('timeline.fab.addEvent')}
    >
      <Plus size="lg" />
    </button>
  );
};

export default TimelineFab;
