import React, { useMemo, useState } from 'react';
import { Eye } from '../../icons';
import { IconButton } from '../../IconButton';
import TemplateEditor from './TemplateEditor';
import PromptPreviewModal from './PromptPreviewModal';
import ScenarioBlocksEditor from './ScenarioBlocksEditor';
import type { ScenarioDocument, TaskType } from '../../../types/scenarios';
import { useSettingsToast } from '../SettingsToastContext';
import './ScenarioEditor.css';

type TemplateValidationResult = {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
};

function estimateScenarioCharCount(scenario: ScenarioDocument): number {
  let count = 0;
  count += scenario.system_template?.length ?? 0;
  for (const block of scenario.blocks || []) {
    if (block.type === 'staticPrompt') {
      count += block.staticPrompt?.template?.length ?? 0;
    } else if (block.type === 'rangeMapping') {
      count += block.rangeMapping?.user_template?.length ?? 0;
      count += block.rangeMapping?.assistant_template?.length ?? 0;
    }
  }
  return count;
}

export interface ScenarioEditorProps {
  taskType: TaskType;
  taskSubtype: string;
  scenario: ScenarioDocument;
  isLoading?: boolean;
  loadError?: string;
  dirty?: boolean;
  saveWarnings?: string[];
  onScenarioChange: (scenario: ScenarioDocument) => void;
}

const ScenarioEditor: React.FC<ScenarioEditorProps> = ({
  taskType,
  taskSubtype,
  scenario,
  isLoading = false,
  loadError,
  dirty = false,
  saveWarnings,
  onScenarioChange,
}) => {
  const toast = useSettingsToast();
  const [showSystemPreview, setShowSystemPreview] = useState(false);
  const [systemValidation] = useState<TemplateValidationResult | null>(null);

  const charCount = useMemo(() => estimateScenarioCharCount(scenario), [scenario]);

  if (loadError) {
    return (
      <div className="scenario-editor scenario-editor--error">
        <div className="scenario-editor__error-title">Failed to load scenario</div>
        <div className="scenario-editor__error-detail">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="scenario-editor">
      {saveWarnings && saveWarnings.length > 0 && (
        <div className="scenario-editor__warnings">
          <div className="scenario-editor__warnings-title">Saved with warnings</div>
          <ul className="scenario-editor__warnings-list">
            {saveWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="scenario-editor__meta">
        <span>Chars: {charCount}</span>
        {dirty && <span className="scenario-editor__dirty"> • Unsaved changes</span>}
      </div>

      <section className="scenario-editor__section">
        <header className="scenario-editor__section-header">
          <h4 className="scenario-editor__section-title">System Prompt</h4>
          <IconButton
            icon={<Eye size="sm" />}
            onClick={() => setShowSystemPreview(true)}
            title="Preview system template"
            size="sm"
            variant="ghost"
          />
        </header>
        <TemplateEditor
          content={scenario.system_template || ''}
          onContentChange={(text) => {
            onScenarioChange({ ...scenario, system_template: text });
          }}
          validation={systemValidation}
          isLoading={isLoading}
          placeholder="Enter system prompt template..."
        />
      </section>

      <section className="scenario-editor__section">
        <header className="scenario-editor__section-header">
          <h4 className="scenario-editor__section-title">Conversation Blocks</h4>
        </header>
        <ScenarioBlocksEditor
          taskType={taskType}
          taskSubtype={taskSubtype}
          systemTemplate={scenario.system_template}
          blocks={scenario.blocks || []}
          onBlocksChange={(blocks) => onScenarioChange({ ...scenario, blocks })}
          onToast={(kind, message) => {
            if (kind === 'success') toast.success(message);
            else if (kind === 'warning') toast.error(message);
            else toast.error(message);
          }}
        />
      </section>

      {showSystemPreview && (
        <PromptPreviewModal
          isOpen={showSystemPreview}
          onClose={() => setShowSystemPreview(false)}
          templateContent={scenario.system_template || ''}
          taskType={taskType}
          taskSubtype={taskSubtype}
          injectedInputKey={null}
          isMemoryPrompt={false}
        />
      )}
    </div>
  );
};

export default ScenarioEditor;

