import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AITaskType, TaskAIConfig } from '../../store/settingsStore';
import TaskConfigForm from './TaskConfigForm';
import { SpeechBubble, Globe, Edit, Palette, Document, People } from '../icons';
import './GeneralPanel.css';

interface GeneralPanelProps {
  task_configs: Record<AITaskType, TaskAIConfig>;
  activeTask: AITaskType;
  onTaskChange: (taskType: AITaskType) => void;
  onConfigChange: (taskType: AITaskType, config: TaskAIConfig) => void;
}

const TASK_ICONS: Record<AITaskType, React.ReactNode> = {
  agent: <SpeechBubble size="sm" />,
  translation: <Globe size="sm" />,
  editAssistant: <Edit size="sm" />,
  imagePrompt: <Palette size="sm" />,
  summary: <Document size="sm" />,
  subAgent: <People size="sm" />,
};

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  task_configs,
  activeTask,
  onTaskChange,
  onConfigChange,
}) => {
  const { t } = useTranslation();
  const currentConfig = task_configs[activeTask];

  const taskTypes: AITaskType[] = ['agent', 'translation', 'editAssistant', 'imagePrompt', 'summary', 'subAgent'];

  return (
    <div className="general-panel">
      <div className="panel-header">
        <h3>{t('settings.general.title')}</h3>
        <p className="panel-description">{t('settings.general.description')}</p>
      </div>

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
        onChange={(config) => onConfigChange(activeTask, config)}
      />
    </div>
  );
};

export default GeneralPanel;
