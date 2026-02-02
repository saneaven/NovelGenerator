import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../../BaseModal';
import { TextButton } from '../../TextButton';
import { useSettingsStore } from '../../../store/settingsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type { SubAgentCreate, SubAgentAllowedMode } from '../../../types/subAgents';

interface CreateSubAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (subAgentId: string) => void;
}

function isValidSubAgentId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

const DEFAULT_ALLOWED_MODES: SubAgentAllowedMode[] = ['storyObject', 'novelEditor', 'outlineManager', 'subAgent'];

const CreateSubAgentModal: React.FC<CreateSubAgentModalProps> = ({ isOpen, onClose, onCreated }) => {
  const { t } = useTranslation();
  const { createSubAgent } = useSubAgentStore();
  const getTaskConfig = useSettingsStore((s) => s.getTaskConfig);

  const defaultConfig = useMemo(() => getTaskConfig('agent'), [getTaskConfig]);

  const [subAgentId, setSubAgentId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setSubAgentId('');
    setDisplayName('');
    setDescription('');
    setError('');
    setIsCreating(false);
  };

  const handleClose = () => {
    if (!isCreating) {
      reset();
      onClose();
    }
  };

  const handleCreate = async () => {
    const id = subAgentId.trim();
    const name = displayName.trim();
    const desc = description.trim();

    if (!id) {
      setError(t('settings.promptEditor.subAgentCreate.idRequired'));
      return;
    }
    if (id.length > 50) {
      setError(t('settings.promptEditor.subAgentCreate.idTooLong'));
      return;
    }
    if (!isValidSubAgentId(id)) {
      setError(t('settings.promptEditor.subAgentCreate.invalidId'));
      return;
    }
    if (!name) {
      setError(t('settings.promptEditor.subAgentCreate.nameRequired'));
      return;
    }

    setIsCreating(true);
    setError('');

    const payload: SubAgentCreate = {
      sub_agent_id: id,
      display_name: name,
      description: desc ? desc : null,
      enabled: true,
      allowed_agent_modes: DEFAULT_ALLOWED_MODES,
      allowed_tool_names: [],
      llm_config: defaultConfig,
    };

    try {
      const created = await createSubAgent(payload);
      onCreated(created.sub_agent_id);
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.message || t('settings.promptEditor.subAgentCreate.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.promptEditor.subAgentCreate.title')}
      size="small"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={handleClose}>
            {t('common.cancel')}
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleCreate}
            disabled={isCreating || !subAgentId.trim() || !displayName.trim()}
            loading={isCreating}
          >
            {t('settings.promptEditor.subAgentCreate.create')}
          </TextButton>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="sub-agent-id">
          {t('settings.promptEditor.subAgentCreate.id')}
        </label>
        <input
          id="sub-agent-id"
          className="form-input"
          type="text"
          value={subAgentId}
          onChange={(e) => setSubAgentId(e.target.value)}
          placeholder={t('settings.promptEditor.subAgentCreate.idPlaceholder')}
          autoFocus
        />
        <small className="form-hint">{t('settings.promptEditor.subAgentCreate.idHint')}</small>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="sub-agent-name">
          {t('settings.promptEditor.subAgentCreate.name')}
        </label>
        <input
          id="sub-agent-name"
          className="form-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('settings.promptEditor.subAgentCreate.namePlaceholder')}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="sub-agent-desc">
          {t('settings.promptEditor.subAgentCreate.description')}
        </label>
        <textarea
          id="sub-agent-desc"
          className="form-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.promptEditor.subAgentCreate.descriptionPlaceholder')}
          rows={3}
        />
      </div>

      {error && <div className="form-error">{error}</div>}
    </BaseModal>
  );
};

export default CreateSubAgentModal;
