/**
 * Prompt Preview Modal
 * Displays a rendered preview of the prompt template with adjustable variables.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../../BaseModal';
import { Eye, ChevronRight, Refresh, Globe, List } from '../../icons';
import { CustomSelect } from '../../ui/CustomSelect';
import ToggleSwitch from '../../common/ToggleSwitch';
import { usePromptPreview } from '../hooks/usePromptPreview';
import { useProjectStore } from '../../../store/projectStore';
import { getPromptTypeFields, type PromptTypeField } from './promptTypeFields';
import type { TaskType } from '../../../types/scenarios';
import type { ConfigData } from '../../../templateEngine/schema';
import './PromptPreviewModal.css';

interface PromptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateContent: string;
  taskType: TaskType;
  taskSubtype: string;
  injectedInputKey?: 'userMessage' | 'agentMessage' | 'subAgentMessage' | null;
  isMemoryPrompt?: boolean;
}

const PromptPreviewModal: React.FC<PromptPreviewModalProps> = ({
  isOpen,
  onClose,
  templateContent,
  taskType,
  taskSubtype,
  injectedInputKey,
  isMemoryPrompt,
}) => {
  const { t } = useTranslation();
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const [promptTypeExpanded, setPromptTypeExpanded] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [variablesExpanded, setVariablesExpanded] = useState(false);

  const {
    renderedPreview,
    isLoading,
    error,
    characterCount,
    tokenCount,
    isCountingTokens,
    isTokenCountEstimate,
    showProjectContext,
    setShowProjectContext,
    includeAllFilteredIds,
    setIncludeAllFilteredIds,
    configOverrides,
    setConfigOverride,
    promptTypeOverrides,
    setPromptTypeOverride,
    variableOverrides,
    setVariableOverride,
    userVariables,
    resetOverrides,
    refresh,
  } = usePromptPreview({
    templateContent,
    taskType,
    taskSubtype: taskSubtype || '',
    injectedInputKey,
    isMemoryPrompt,
  });

  // Get fields for the current prompt type
  const promptTypeFields = useMemo(() => getPromptTypeFields(taskType), [taskType]);

  const thinking_modeOptions = [
    { value: 'off', label: t('settings.promptEditor.preview.thinking_mode.off') },
    { value: 'model', label: t('settings.promptEditor.preview.thinking_mode.model') },
    { value: 'custom', label: t('settings.promptEditor.preview.thinking_mode.custom') },
  ];

  const outputModeOptions = [
    { value: 'tool_call', label: t('settings.promptEditor.preview.outputMode.toolCall') },
    { value: 'native_tool_call', label: t('settings.promptEditor.preview.outputMode.nativeToolCall') },
    { value: 'raw_output', label: t('settings.promptEditor.preview.outputMode.rawOutput') },
  ];

  const hasOverrides = Object.keys(configOverrides).length > 0
    || Object.keys(promptTypeOverrides).length > 0
    || Object.keys(variableOverrides).length > 0;

  // Render a prompt type field control
  const renderPromptTypeField = (field: PromptTypeField) => {
    const value = promptTypeOverrides[field.path] ?? '';

    switch (field.type) {
      case 'dropdown':
        return (
          <CustomSelect
            value={value as string}
            onChange={(v) => setPromptTypeOverride(field.path, v)}
            options={field.options?.map(opt => ({ value: opt, label: opt })) || []}
          />
        );
      case 'boolean':
        return (
          <label className="prompt-preview-checkbox-label">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => setPromptTypeOverride(field.path, e.target.checked)}
            />
            <span>{value ? t('common.true') : t('common.false')}</span>
          </label>
        );
      case 'textarea':
        return (
          <textarea
            className="prompt-preview-textarea"
            value={value as string}
            onChange={(e) => setPromptTypeOverride(field.path, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
          />
        );
      case 'text':
      default:
        return (
          <input
            type="text"
            className="prompt-preview-text-input"
            value={value as string}
            onChange={(e) => setPromptTypeOverride(field.path, e.target.value)}
            placeholder={field.placeholder}
          />
        );
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          <Eye size="sm" />
          {t('settings.promptEditor.preview.title')}
        </>
      }
      size="large"
      className="prompt-preview-modal"
    >
      <div className="prompt-preview-modal-content">
        {/* Control Bar */}
        <div className="prompt-preview-controls">
          <div className="prompt-preview-controls-left">
            {/* Show Project Context Toggle */}
            <ToggleSwitch
              checked={showProjectContext}
              onChange={setShowProjectContext}
              label={t('settings.promptEditor.preview.showProjectContext')}
              icon={<Globe size="sm" />}
              disabled={!currentProjectId}
            />

            {/* Include All Filtered IDs Toggle */}
            <ToggleSwitch
              checked={includeAllFilteredIds}
              onChange={setIncludeAllFilteredIds}
              label={t('settings.promptEditor.preview.includeFilteredIds')}
              icon={<List size="sm" />}
            />
          </div>

          <div className="prompt-preview-controls-right">
            <button
              className="prompt-preview-refresh-btn"
              onClick={refresh}
              disabled={isLoading}
              title={t('common.refresh')}
            >
              <Refresh size="sm" />
            </button>
            <span className="prompt-preview-char-count">
              {t('settings.promptEditor.preview.characterCount', { count: characterCount })}
            </span>
            <span className="prompt-preview-token-count">
              {isCountingTokens ? (
                <span className="prompt-preview-token-spinner" />
              ) : tokenCount !== null ? (
                <>
                  {t('settings.promptEditor.preview.tokenCount', { count: tokenCount })}
                  {isTokenCountEstimate && (
                    <span
                      className="prompt-preview-token-estimate"
                      title={t('settings.promptEditor.preview.tokenEstimateHint')}
                    >
                      ~
                    </span>
                  )}
                </>
              ) : null}
            </span>
          </div>
        </div>

        {/* No Project Warning */}
        {!currentProjectId && !showProjectContext && (
          <div className="prompt-preview-warning">
            {t('settings.promptEditor.preview.noProjectWarning')}
          </div>
        )}

        {/* Prompt-Type Controls Panel */}
        {promptTypeFields.length > 0 && (
          <div className="prompt-preview-overrides">
            <div
              className={`prompt-preview-overrides-header ${promptTypeExpanded ? 'expanded' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setPromptTypeExpanded(!promptTypeExpanded)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPromptTypeExpanded(!promptTypeExpanded); } }}
            >
              <span className="prompt-preview-overrides-chevron">
                <ChevronRight size="sm" />
              </span>
              <span className="prompt-preview-overrides-title">
                {t('settings.promptEditor.preview.promptTypeControls')}
              </span>
            </div>

            {promptTypeExpanded && (
              <div className="prompt-preview-overrides-content">
                <div className="prompt-preview-overrides-grid">
                  {promptTypeFields.map((field) => (
                    <div key={field.path} className="prompt-preview-override-item">
                      <label>{field.label}</label>
                      {renderPromptTypeField(field)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Config Overrides Panel */}
        <div className="prompt-preview-overrides">
          <div
            className={`prompt-preview-overrides-header ${configExpanded ? 'expanded' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setConfigExpanded(!configExpanded)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConfigExpanded(!configExpanded); } }}
          >
            <span className="prompt-preview-overrides-chevron">
              <ChevronRight size="sm" />
            </span>
            <span className="prompt-preview-overrides-title">
              {t('settings.promptEditor.preview.configSection')}
            </span>
            {hasOverrides && (
              <button
                className="prompt-preview-reset-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  resetOverrides();
                }}
              >
                {t('settings.promptEditor.preview.resetOverrides')}
              </button>
            )}
          </div>

          {configExpanded && (
            <div className="prompt-preview-overrides-content">
              <div className="prompt-preview-overrides-grid">
                {/* Thinking Mode */}
                <div className="prompt-preview-override-item">
                  <label>thinking_mode</label>
                  <CustomSelect
                    value={(configOverrides.thinking_mode as string) || 'off'}
                    onChange={(value) => setConfigOverride('thinking_mode', value as ConfigData['thinking_mode'])}
                    options={thinking_modeOptions}
                  />
                </div>

                {/* Output Mode */}
                <div className="prompt-preview-override-item">
                  <label>outputMode</label>
                  <CustomSelect
                    value={(configOverrides.outputMode as string) || 'tool_call'}
                    onChange={(value) => setConfigOverride('outputMode', value as ConfigData['outputMode'])}
                    options={outputModeOptions}
                  />
                </div>

                {/* Prefill Enabled */}
                <div className="prompt-preview-override-item">
                  <label>isPrefillEnabled</label>
                  <label className="prompt-preview-checkbox-label">
                    <input
                      type="checkbox"
                      checked={configOverrides.isPrefillEnabled ?? false}
                      onChange={(e) => setConfigOverride('isPrefillEnabled', e.target.checked)}
                    />
                    <span>{t('common.enabled')}</span>
                  </label>
                </div>

                {/* Main Language */}
                <div className="prompt-preview-override-item">
                  <label>mainLanguage</label>
                  <input
                    type="text"
                    className="prompt-preview-text-input"
                    value={(configOverrides.mainLanguage as string) || ''}
                    onChange={(e) => setConfigOverride('mainLanguage', e.target.value || undefined)}
                    placeholder="English"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Variables Panel */}
        {userVariables.length > 0 && (
          <div className="prompt-preview-overrides">
            <div
              className={`prompt-preview-overrides-header ${variablesExpanded ? 'expanded' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setVariablesExpanded(!variablesExpanded)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVariablesExpanded(!variablesExpanded); } }}
            >
              <span className="prompt-preview-overrides-chevron">
                <ChevronRight size="sm" />
              </span>
              <span className="prompt-preview-overrides-title">
                {t('settings.promptEditor.preview.variablesSection')}
              </span>
            </div>

            {variablesExpanded && (
              <div className="prompt-preview-overrides-content">
                <div className="prompt-preview-overrides-grid">
                  {userVariables.map((variable) => (
                    <div key={variable.id} className="prompt-preview-override-item">
                      <label>{variable.name}</label>
                      {variable.var_type === 'boolean' ? (
                        <label className="prompt-preview-checkbox-label">
                          <input
                            type="checkbox"
                            checked={(variableOverrides[variable.name] ?? variable.value) as boolean}
                            onChange={(e) => setVariableOverride(variable.name, e.target.checked)}
                          />
                          <span>{(variableOverrides[variable.name] ?? variable.value) ? t('common.true') : t('common.false')}</span>
                        </label>
                      ) : variable.var_type === 'select' && variable.select_options ? (
                        <CustomSelect
                          value={(variableOverrides[variable.name] ?? variable.value ?? '') as string}
                          onChange={(value) => setVariableOverride(variable.name, value)}
                          options={variable.select_options.map(opt => ({ value: opt, label: opt }))}
                        />
                      ) : variable.var_type === 'number' ? (
                        <input
                          type="number"
                          className="prompt-preview-text-input"
                          value={(variableOverrides[variable.name] ?? variable.value ?? 0) as number}
                          onChange={(e) => setVariableOverride(variable.name, parseFloat(e.target.value) || 0)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="prompt-preview-text-input"
                          value={(variableOverrides[variable.name] ?? variable.value ?? '') as string}
                          onChange={(e) => setVariableOverride(variable.name, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview Content */}
        <div className="prompt-preview-output">
          {isLoading ? (
            <div className="prompt-preview-loading">
              <span className="prompt-preview-spinner" />
              Loading preview...
            </div>
          ) : error ? (
            <div className="prompt-preview-error">
              <strong>{t('settings.promptEditor.preview.renderError')}</strong>
              <pre>{error}</pre>
            </div>
          ) : (
            <pre className="prompt-preview-content">{renderedPreview}</pre>
          )}
        </div>
      </div>
    </BaseModal>
  );
};

export default PromptPreviewModal;
