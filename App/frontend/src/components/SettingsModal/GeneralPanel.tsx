import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AITaskType, TaskAIConfig, ProviderCredentials } from '../../store/settingsStore';
import TaskConfigForm from './TaskConfigForm';
import { SpeechBubble, Globe, Edit, Palette } from '../icons';
import './GeneralPanel.css';

interface GeneralPanelProps {
  taskConfigs: {
    agent: TaskAIConfig;
    translation: TaskAIConfig;
    editAssistant: TaskAIConfig;
    imagePrompt: TaskAIConfig;
  };
  credentials: ProviderCredentials;
  activeTask: AITaskType;
  onTaskChange: (taskType: AITaskType) => void;
  onConfigChange: (taskType: AITaskType, config: TaskAIConfig) => void;
}

const TASK_ICONS: Record<AITaskType, React.ReactNode> = {
  agent: <SpeechBubble size="sm" />,
  translation: <Globe size="sm" />,
  editAssistant: <Edit size="sm" />,
  imagePrompt: <Palette size="sm" />,
};

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  taskConfigs,
  credentials,
  activeTask,
  onTaskChange,
  onConfigChange,
}) => {
  const { t } = useTranslation();
  const currentConfig = taskConfigs[activeTask];

  const taskTypes: AITaskType[] = ['agent', 'translation', 'editAssistant', 'imagePrompt'];

  return (
    <div className="general-panel">
      {/* Task Selection Tabs */}
      <div className="task-selector">
        {taskTypes.map((taskType) => {
          const isActive = taskType === activeTask;

          return (
            <button
              key={taskType}
              className={`task-tab ${isActive ? 'active' : ''}`}
              onClick={() => onTaskChange(taskType)}
            >
              <span className="tab-icon">{TASK_ICONS[taskType]}</span>
              <span className="tab-label">{t(`settings.general.tasks.${taskType}.label`)}</span>
            </button>
          );
        })}
      </div>

      {/* Task Description */}
      <div className="task-description">
        <div className="description-header">
          <span className="description-icon">{TASK_ICONS[activeTask]}</span>
          <h3>{t(`settings.general.tasks.${activeTask}.label`)} {t('settings.general.configuration')}</h3>
        </div>
        <p>{t(`settings.general.tasks.${activeTask}.description`)}</p>
      </div>

      {/* Configuration Form */}
      <TaskConfigForm
        taskType={activeTask}
        config={currentConfig}
        credentials={credentials}
        onChange={(config) => onConfigChange(activeTask, config)}
      />
    </div>
  );
};

export default GeneralPanel;
