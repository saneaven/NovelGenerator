import React from 'react';
import type { AIFunctionType, FunctionAIConfig, ProviderCredentials } from '../../store/settingsStore';
import FunctionConfigForm from './FunctionConfigForm';
import { Chat, Globe, Edit, Palette } from '../icons';
import './GeneralPanel.css';

interface GeneralPanelProps {
  functionConfigs: {
    chat: FunctionAIConfig;
    translation: FunctionAIConfig;
    editAssistant: FunctionAIConfig;
    imagePrompt: FunctionAIConfig;
  };
  credentials: ProviderCredentials;
  activeFunction: AIFunctionType;
  onFunctionChange: (functionType: AIFunctionType) => void;
  onConfigChange: (functionType: AIFunctionType, config: FunctionAIConfig) => void;
}

const FUNCTION_LABELS: Record<AIFunctionType, { icon: React.ReactNode; label: string }> = {
  chat: { icon: <Chat size="sm" />, label: 'Chat' },
  translation: { icon: <Globe size="sm" />, label: 'Translation' },
  editAssistant: { icon: <Edit size="sm" />, label: 'Edit Assistant' },
  imagePrompt: { icon: <Palette size="sm" />, label: 'Image Prompt' },
};

const FUNCTION_DESCRIPTIONS: Record<AIFunctionType, string> = {
  chat: 'General conversation and assistance for story planning and brainstorming',
  translation: 'Accurate language translation with context preservation',
  editAssistant: 'Editing and refinement of story objects and manuscript content',
  imagePrompt: 'AI-assisted generation of detailed image prompts from story context',
};

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  functionConfigs,
  credentials,
  activeFunction,
  onFunctionChange,
  onConfigChange,
}) => {
  const currentConfig = functionConfigs[activeFunction];

  return (
    <div className="general-panel">
      {/* Function Selection Tabs */}
      <div className="function-selector">
        {(Object.keys(FUNCTION_LABELS) as AIFunctionType[]).map((funcType) => {
          const { icon, label } = FUNCTION_LABELS[funcType];
          const isActive = funcType === activeFunction;

          return (
            <button
              key={funcType}
              className={`function-tab ${isActive ? 'active' : ''}`}
              onClick={() => onFunctionChange(funcType)}
            >
              <span className="tab-icon">{icon}</span>
              <span className="tab-label">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Function Description */}
      <div className="function-description">
        <div className="description-header">
          <span className="description-icon">{FUNCTION_LABELS[activeFunction].icon}</span>
          <h3>{FUNCTION_LABELS[activeFunction].label} Configuration</h3>
        </div>
        <p>{FUNCTION_DESCRIPTIONS[activeFunction]}</p>
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
