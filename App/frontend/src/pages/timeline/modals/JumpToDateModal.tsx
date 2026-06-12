import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BaseModal from '../../../components/BaseModal/BaseModal';
import TextButton from '../../../components/TextButton/TextButton';
import type { CalendarConfig, TimelineDate } from '../../../types/timeline';
import { toBaseUnits, validateDate } from '../../../utils/timelineCalendar';
import DateFieldsInput from './DateFieldsInput';
import './TimelineModals.css';

interface JumpToDateModalProps {
  calendar: CalendarConfig;
  onJump: (base: number) => void;
  onClose: () => void;
}

const JumpToDateModal: React.FC<JumpToDateModalProps> = ({ calendar, onJump, onClose }) => {
  const { t } = useTranslation();
  const initialDate = useMemo(() => {
    const date: TimelineDate = {};
    for (const unit of calendar.units) date[unit.name] = 1;
    return date;
  }, [calendar]);
  const [date, setDate] = useState<TimelineDate>(initialDate);

  const handleJump = () => {
    if (!validateDate(date, calendar)) return;
    onJump(toBaseUnits(date, calendar));
    onClose();
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t('timeline.jumpModal.title')}
      size="small"
      footer={
        <div className="tl-modal-footer">
          <TextButton variant="secondary" onClick={onClose}>{t('common.cancel')}</TextButton>
          <TextButton variant="primary" onClick={handleJump}>{t('timeline.jumpModal.go')}</TextButton>
        </div>
      }
    >
      <div className="tl-form">
        <DateFieldsInput calendar={calendar} value={date} onChange={setDate} idPrefix="tl-jump" />
      </div>
    </BaseModal>
  );
};

export default JumpToDateModal;
