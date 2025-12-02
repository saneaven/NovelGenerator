import React from 'react';
import type { AIFunctionType, FunctionAIConfig, ProviderCredentials } from '../../store/settingsStore';
import FunctionConfigForm from './FunctionConfigForm';
import './GeneralPanel.css';

interface GeneralPanelProps {
  functionConfigs: {
    chat: FunctionAIConfig;
    translation: FunctionAIConfig;
    storyEdit: FunctionAIConfig;
    chapterGen: FunctionAIConfig;
    imagePrompt: FunctionAIConfig;
  };
  credentials: ProviderCredentials;
  activeFunction: AIFunctionType;
  onFunctionChange: (functionType: AIFunctionType) => void;
  onConfigChange: (functionType: AIFunctionType, config: FunctionAIConfig) => void;
}

const FUNCTION_LABELS = {
  chat: { icon: '💬', label: 'Chat' },
  translation: { icon: '🌐', label: 'Translation' },
  storyEdit: { icon: '✏️', label: 'Story Edit' },
  chapterGen: { icon: '📝', label: 'Chapter Gen' },
  imagePrompt: { icon: '🎨', label: 'Image Prompt' },
};

const FUNCTION_DESCRIPTIONS = {
  chat: 'General conversation and assistance for story planning and brainstorming',
  translation: 'Accurate language translation with context preservation',
  storyEdit: 'Structured editing and refinement of story elements',
  chapterGen: 'Creative generation of novel chapters and narrative content',
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
