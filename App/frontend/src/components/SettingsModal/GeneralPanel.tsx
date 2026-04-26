import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton';
import type { AITaskType, CustomThinkingTemplate, TaskConfigSettings } from '../../store/settingsStore';
import {
  TASK_CONFIG_TASK_TYPES,
  hasTaskOverride,
  normalizeEffectiveTaskConfig,
  resolveAllTaskConfigs,
} from '../../store/taskConfigSettings';
import TaskConfigForm from './TaskConfigForm';
import ToggleSwitch from '../common/ToggleSwitch';
import { TextButton } from '../TextButton';
import { ChevronLeft, ChevronRight, SpeechBubble, Globe, Edit, Palette, Document, People, Settings } from '../icons';
import './GeneralPanel.css';

type GeneralConfigTarget = 'general' | AITaskType;

interface GeneralPanelProps {
  taskConfigSettings: TaskConfigSettings;
  activeTarget: GeneralConfigTarget;
  onTargetChange: (target: GeneralConfigTarget) => void;
  onTaskConfigSettingsChange: (taskConfigSettings: TaskConfigSettings) => void;
  customThinkingTemplates?: CustomThinkingTemplate[];
  onTemplatesChange?: (templates: CustomThinkingTemplate[]) => void;
}

const TASK_ICONS: Record<GeneralConfigTarget, React.ReactNode> = {
  general: <Settings size="sm" />,
  agent: <SpeechBubble size="sm" />,
  translation: <Globe size="sm" />,
  editAssistant: <Edit size="sm" />,
  imagePrompt: <Palette size="sm" />,
  summary: <Document size="sm" />,
  subAgent: <People size="sm" />,
};

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.innerWidth <= 768;

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  taskConfigSettings,
  activeTarget,
  onTargetChange,
  onTaskConfigSettingsChange,
  customThinkingTemplates,
  onTemplatesChange,
}) => {
  const { t } = useTranslation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => isMobileViewport());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastIsMobile = isMobileViewport();
    const handleResize = () => {
      const nextIsMobile = isMobileViewport();
      if (nextIsMobile !== lastIsMobile) {
        setIsSidebarCollapsed(nextIsMobile);
        lastIsMobile = nextIsMobile;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const resolvedTaskConfigs = useMemo(
    () => resolveAllTaskConfigs(taskConfigSettings),
    [taskConfigSettings]
  );

  const activeTaskType = activeTarget === 'general' ? undefined : activeTarget;
  const activeTaskConfig = activeTaskType ? resolvedTaskConfigs[activeTaskType] : undefined;
  const activeOverrideEnabled = activeTaskType ? hasTaskOverride(taskConfigSettings, activeTaskType) : false;
  const activeTemperatureValue = Number.isFinite(activeTaskConfig?.temperature)
    ? (activeTaskConfig?.temperature as number)
    : 0.7;

  const handleGeneralChange = (nextGeneralConfig: typeof taskConfigSettings.general) => {
    onTaskConfigSettingsChange({
      ...taskConfigSettings,
      general: normalizeEffectiveTaskConfig(nextGeneralConfig),
    });
  };

  const handleOverrideToggle = (taskType: AITaskType, enabled: boolean) => {
    const nextOverrides = { ...taskConfigSettings.overrides };
    if (enabled) {
      nextOverrides[taskType] = nextOverrides[taskType] ?? normalizeEffectiveTaskConfig(taskConfigSettings.general);
    } else {
      delete nextOverrides[taskType];
    }
    onTaskConfigSettingsChange({
      ...taskConfigSettings,
      overrides: nextOverrides,
    });
  };

  const handleTaskConfigChange = (taskType: AITaskType, nextEffectiveConfig: typeof taskConfigSettings.general) => {
    onTaskConfigSettingsChange({
      ...taskConfigSettings,
      overrides: {
        ...taskConfigSettings.overrides,
        [taskType]: normalizeEffectiveTaskConfig(nextEffectiveConfig),
      },
    });
  };

  const handleResetOverride = (taskType: AITaskType) => {
    const nextOverrides = { ...taskConfigSettings.overrides };
    delete nextOverrides[taskType];
    onTaskConfigSettingsChange({
      ...taskConfigSettings,
      overrides: nextOverrides,
    });
  };

  const handleTargetSelect = (target: GeneralConfigTarget) => {
    onTargetChange(target);
    if (isMobileViewport()) {
      setIsSidebarCollapsed(true);
    }
  };

  return (
    <div className="general-panel">
      <div className={`general-panel__layout ${isSidebarCollapsed ? 'general-panel__layout--collapsed' : ''}`}>
        {!isSidebarCollapsed && (
          <div
            className="general-panel__backdrop"
            onClick={() => setIsSidebarCollapsed(true)}
          />
        )}

        <main className="general-panel__main">
          <div className="general-panel__content">
            <div className="general-panel__header-row">
              <div className="panel-header">
                <h3>{t('settings.general.title')}</h3>
                <p className="panel-description">{t('settings.general.description')}</p>
              </div>
              <IconButton
                icon={isSidebarCollapsed ? <ChevronLeft size="lg" /> : <ChevronRight size="lg" />}
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                title={
                  isSidebarCollapsed
                    ? t('settings.promptEditor.expandSidebar')
                    : t('settings.promptEditor.collapseSidebar')
                }
                ariaExpanded={!isSidebarCollapsed}
                size="lg"
                variant="ghost"
                className="general-panel__sidebar-toggle"
              />
            </div>

            <div className="general-panel__body">
              {activeTarget === 'general' ? (
                <>
                  <div className="task-description">
                    <div className="description-header">
                      <span className="description-icon">{TASK_ICONS.general}</span>
                      <h3>{t('settings.general.generalConfigTitle')}</h3>
                    </div>
                    <p>{t('settings.general.generalDescription')}</p>
                  </div>

                  <TaskConfigForm
                    taskType="agent"
                    formKey="general"
                    config={taskConfigSettings.general}
                    onChange={handleGeneralChange}
                    customThinkingTemplates={customThinkingTemplates}
                    onTemplatesChange={onTemplatesChange}
                  />
                </>
              ) : activeTaskType && activeTaskConfig ? (
                <>
                  <div className="task-description">
                    <div className="description-header">
                      <span className="description-icon">{TASK_ICONS[activeTaskType]}</span>
                      <h3>{t(`settings.general.tasks.${activeTaskType}.label`)} {t('settings.general.configuration')}</h3>
                    </div>
                    <p>{t(`settings.general.tasks.${activeTaskType}.description`)}</p>
                  </div>

                  <div className="general-panel__override-card">
                    <ToggleSwitch
                      checked={activeOverrideEnabled}
                      onChange={(checked) => handleOverrideToggle(activeTaskType, checked)}
                      label={t('settings.general.overrideToggle')}
                    />
                    <p className="general-panel__hint">{t('settings.general.overrideHint')}</p>
                  </div>

                  {!activeOverrideEnabled ? (
                    <div className="general-panel__inherit-card">
                      <div className="general-panel__inherit-header">
                        <h4>{t('settings.general.inheritedTitle')}</h4>
                        <span className="general-panel__inherit-badge">{t('settings.general.inheritedBadge')}</span>
                      </div>
                      <p className="general-panel__hint">{t('settings.general.inheritedDescription')}</p>
                      <dl className="general-panel__summary-grid">
                        <div>
                          <dt>{t('settings.taskConfig.provider')}</dt>
                          <dd>{activeTaskConfig.provider}</dd>
                        </div>
                        <div>
                          <dt>{t('settings.taskConfig.aiModel')}</dt>
                          <dd>{activeTaskConfig.model}</dd>
                        </div>
                        <div>
                          <dt>{t('settings.taskConfig.temperature')}</dt>
                          <dd>{activeTemperatureValue.toFixed(1)}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <>
                      <div className="general-panel__override-actions">
                        <p className="general-panel__hint">{t('settings.general.overrideFormHint')}</p>
                        <TextButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleResetOverride(activeTaskType)}
                        >
                          {t('settings.general.resetOverride')}
                        </TextButton>
                      </div>
                      <TaskConfigForm
                        taskType={activeTaskType}
                        formKey={activeTaskType}
                        config={activeTaskConfig}
                        onChange={(config) => handleTaskConfigChange(activeTaskType, config)}
                        customThinkingTemplates={customThinkingTemplates}
                        onTemplatesChange={onTemplatesChange}
                      />
                    </>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </main>

        <aside className="general-panel__sidebar">
          <div className="general-panel__sidebar-header">
            <h4>{t('settings.general.sidebarTitle')}</h4>
          </div>

          <div className="general-panel__sidebar-section-label">
            {t('settings.general.baseSectionLabel')}
          </div>
          <ul className="general-panel__sidebar-list">
            <li>
              <button
                className={`general-panel__sidebar-item ${activeTarget === 'general' ? 'active' : ''}`}
                onClick={() => handleTargetSelect('general')}
              >
                <span className="general-panel__sidebar-item-main">
                  <span className="general-panel__sidebar-item-icon">{TASK_ICONS.general}</span>
                  <span className="general-panel__sidebar-item-label">{t('settings.general.generalLabel')}</span>
                </span>
              </button>
            </li>
          </ul>

          <div className="general-panel__sidebar-separator" />

          <div className="general-panel__sidebar-section-label">
            {t('settings.general.taskSectionLabel')}
          </div>
          <ul className="general-panel__sidebar-list">
            {TASK_CONFIG_TASK_TYPES.map((taskType) => {
              const isOverrideEnabled = hasTaskOverride(taskConfigSettings, taskType);
              return (
                <li key={taskType}>
                  <button
                    className={`general-panel__sidebar-item ${activeTarget === taskType ? 'active' : ''}`}
                    onClick={() => handleTargetSelect(taskType)}
                  >
                    <span className="general-panel__sidebar-item-main">
                      <span className="general-panel__sidebar-item-icon">{TASK_ICONS[taskType]}</span>
                      <span className="general-panel__sidebar-item-label">
                        {t(`settings.general.tasks.${taskType}.label`)}
                      </span>
                    </span>
                    <span
                      className={`general-panel__sidebar-status ${
                        isOverrideEnabled
                          ? 'general-panel__sidebar-status--override'
                          : 'general-panel__sidebar-status--inherited'
                      }`}
                    >
                      {isOverrideEnabled
                        ? t('settings.general.overrideBadge')
                        : t('settings.general.inheritedBadge')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
};

export default GeneralPanel;
