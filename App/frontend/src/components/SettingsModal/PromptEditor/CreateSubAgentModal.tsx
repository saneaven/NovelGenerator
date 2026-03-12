import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../../BaseModal';
import { TextButton } from '../../TextButton';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type { SubAgentCreate, SubAgentAllowedInvocation } from '../../../types/subAgents';
import { SUB_AGENT_CALL_PREFIX, isValidAgentName } from '../../../subAgent/tools/SubAgentCallTools';

interface CreateSubAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const DEFAULT_ALLOWED_MODES: SubAgentAllowedInvocation[] = ['planMode', 'agentMode', 'subAgent'];

const CreateSubAgentModal: React.FC<CreateSubAgentModalProps> = ({ isOpen, onClose, onCreated }) => {
  const { t } = useTranslation();
  const { createSubAgent } = useSubAgentStore();

  const [agentName, setAgentName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setAgentName('');
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
    let agent_name = agentName.trim();
    if (agent_name.startsWith(SUB_AGENT_CALL_PREFIX)) {
      agent_name = agent_name.slice(SUB_AGENT_CALL_PREFIX.length);
    }
    const name = displayName.trim();
    const desc = description.trim();

    if (!agent_name) {
      setError(t('settings.promptEditor.subAgentCreate.idRequired'));
      return;
    }
    if (agent_name.length > 50) {
      setError(t('settings.promptEditor.subAgentCreate.idTooLong'));
      return;
    }
    if (!isValidAgentName(agent_name)) {
      setError(t('settings.promptEditor.subAgentCreate.invalidId'));
      return;
    }
    if (!name) {
      setError(t('settings.promptEditor.subAgentCreate.nameRequired'));
      return;
    }
    if (!desc) {
      setError(t('settings.promptEditor.subAgentCreate.descriptionRequired'));
      return;
    }

    setIsCreating(true);
    setError('');

    const payload: SubAgentCreate = {
      agent_name,
      display_name: name,
      description: desc,
      enabled: true,
      allowed_invocation_modes: DEFAULT_ALLOWED_MODES,
      allowed_tool_names: [],
      allowed_sub_agent_ids: [],
      allowed_mcp_server_ids: [],
      use_custom_llm_config: false,
      llm_config_override: null,
    };

    try {
      const created = await createSubAgent(payload);
      onCreated(created.id);
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
            disabled={isCreating || !agentName.trim() || !displayName.trim() || !description.trim()}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ opacity: 0.8, fontFamily: 'monospace' }}>call_</span>
            <input
              id="sub-agent-id"
              className="form-input"
              type="text"
              value={agentName}
              onChange={(e) => {
                const next = e.target.value;
                setAgentName(next.startsWith(SUB_AGENT_CALL_PREFIX) ? next.slice(SUB_AGENT_CALL_PREFIX.length) : next);
              }}
              placeholder={t('settings.promptEditor.subAgentCreate.idPlaceholder')}
              autoFocus
            />
        </div>
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
