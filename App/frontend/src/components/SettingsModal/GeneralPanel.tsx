import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AIFunctionType, FunctionAIConfig, ProviderCredentials } from '../../store/settingsStore';
import FunctionConfigForm from './FunctionConfigForm';
import { SpeechBubble, Globe, Edit, Palette } from '../icons';
import './GeneralPanel.css';

interface GeneralPanelProps {
  functionConfigs: {
    agent: FunctionAIConfig;
    translation: FunctionAIConfig;
    editAssistant: FunctionAIConfig;
    imagePrompt: FunctionAIConfig;
  };
  credentials: ProviderCredentials;
  activeFunction: AIFunctionType;
  onFunctionChange: (functionType: AIFunctionType) => void;
  onConfigChange: (functionType: AIFunctionType, config: FunctionAIConfig) => void;
}

const FUNCTION_ICONS: Record<AIFunctionType, React.ReactNode> = {
  agent: <SpeechBubble size="sm" />,
  translation: <Globe size="sm" />,
  editAssistant: <Edit size="sm" />,
  imagePrompt: <Palette size="sm" />,
};

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  functionConfigs,
  credentials,
  activeFunction,
  onFunctionChange,
  onConfigChange,
}) => {
  const { t } = useTranslation();
  const currentConfig = functionConfigs[activeFunction];

  const functionTypes: AIFunctionType[] = ['agent', 'translation', 'editAssistant', 'imagePrompt'];

  return (
    <div className="general-panel">
      {/* Function Selection Tabs */}
      <div className="function-selector">
        {functionTypes.map((funcType) => {
          const isActive = funcType === activeFunction;

          return (
            <button
              key={funcType}
              className={`function-tab ${isActive ? 'active' : ''}`}
              onClick={() => onFunctionChange(funcType)}
            >
              <span className="tab-icon">{FUNCTION_ICONS[funcType]}</span>
              <span className="tab-label">{t(`settings.general.functions.${funcType}.label`)}</span>
            </button>
          );
        })}
      </div>

      {/* Function Description */}
      <div className="function-description">
        <div className="description-header">
          <span className="description-icon">{FUNCTION_ICONS[activeFunction]}</span>
          <h3>{t(`settings.general.functions.${activeFunction}.label`)} {t('settings.general.configuration')}</h3>
        </div>
        <p>{t(`settings.general.functions.${activeFunction}.description`)}</p>
      </div>

      {/* Configuration Form */}
      <FunctionConfigForm
        functionType={activeFunction}
        config={currentConfig}
        credentials={credentials}
        onChange={(config) => onConfigChange(activeFunction, config)}
      />
    </div>
  );
};

export default GeneralPanel;
