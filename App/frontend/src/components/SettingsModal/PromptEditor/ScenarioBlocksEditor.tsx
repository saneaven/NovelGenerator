import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDndSensors } from '../../../hooks/useDndSensors';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from '../../ui/DragHandle';
import { ChevronDown, ChevronUp, Clock, Copy, Eye, Lightning, MoreHorizontal, Plus, Trash } from '../../icons';
import { IconButton } from '../../IconButton';
import { DropdownMenu, DropdownItem, DropdownDivider } from '../../ui/DropdownMenu';
import { BaseModal } from '../../BaseModal';
import ToggleSwitch from '../../common/ToggleSwitch';
import { NumberInput } from '../../ui/NumberInput';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import TemplateEditor from './TemplateEditor';
import PromptPreviewModal from './PromptPreviewModal';
import { buildPreviewData } from './previewDataBuilder';
import { scenarioService } from '../../../api/scenarioService';
import { useProjectStore } from '../../../store/projectStore';
import type { ScenarioBlock, ScenarioDocument, TaskType } from '../../../types/scenarios';
import './ScenarioBlocksEditor.css';

function normalizeBlockOrders(blocks: ScenarioBlock[]): ScenarioBlock[] {
  return blocks.map((b, idx) => ({ ...b, block_order: idx }));
}

function safeUUID(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function oneLinePreview(text: string, maxLen = 120): string {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '(empty)';
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

function buildSampleConversation(runCount: number, includeToolResults: boolean): Array<Record<string, any>> {
  const messages: Array<Record<string, any>> = [];
  for (let i = 1; i <= runCount; i += 1) {
    const runId = `run_${i}`;
    messages.push({
      role: 'user',
      content_parts: [{ type: 'content', text: `User message ${i}` }],
      run_id: runId,
    });
    if (i === runCount) break;

    const callId = `call_${i}`;
    const assistant: Record<string, any> = {
      role: 'assistant',
      content_parts: [{ type: 'content', text: `Assistant message ${i}` }],
      run_id: runId,
    };
    if (includeToolResults) {
      assistant.tool_calls = [
        {
          id: callId,
          type: 'function',
          function: { name: 'dummy_tool', arguments: '{}' },
        },
      ];
    }
    messages.push(assistant);

    if (includeToolResults) {
      messages.push({
        role: 'tool_results',
        tool_call_id: callId,
        content_parts: [{ type: 'content', text: `{"result":"ok ${i}"}` }],
        run_id: runId,
      });
    }
  }
  return messages;
}

interface SortableBlockCardProps {
  block: ScenarioBlock;
  children: React.ReactNode;
}

const SortableBlockCard: React.FC<SortableBlockCardProps> = ({
  block,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="scenario-block-card">
      <div className="scenario-block-card__drag-row">
        <DragHandle
          orientation="horizontal"
          handleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>}
        />
      </div>
      <div className="scenario-block-card__content">{children}</div>
    </div>
  );
};

interface ScenarioBlocksEditorProps {
  taskType: TaskType;
  taskSubtype: string;
  systemTemplate: string;
  blocks: ScenarioBlock[];
  onBlocksChange: (blocks: ScenarioBlock[]) => void;
  headerActionsRef?: React.RefObject<HTMLElement | null>;
  onOpenVersionHistory?: () => void;
  versionHistoryDisabled?: boolean;
}

const ScenarioBlocksEditor: React.FC<ScenarioBlocksEditorProps> = ({
  taskType,
  taskSubtype,
  systemTemplate,
  blocks,
  onBlocksChange,
  headerActionsRef,
  onOpenVersionHistory,
  versionHistoryDisabled = false,
}) => {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Force re-render once the portal target ref is available
  const [, setPortalReady] = useState(false);
  useEffect(() => {
    if (headerActionsRef?.current) setPortalReady(true);
  }, [headerActionsRef]);

  const orderedBlocks = useMemo(() => {
    const list = [...(blocks || [])];
    list.sort((a, b) => (a.block_order ?? 0) - (b.block_order ?? 0));
    return list;
  }, [blocks]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeTemplateTab, setActiveTemplateTab] = useState<Record<string, 'user' | 'assistant'>>({});
  const [preview, setPreview] = useState<{
    open: boolean;
    content: string;
    injectedInputKey: 'userMessage' | 'agentMessage' | 'subAgentMessage' | null;
  }>({ open: false, content: '', injectedInputKey: null });

  const sensors = useDndSensors();

  const setBlocks = (next: ScenarioBlock[]) => onBlocksChange(normalizeBlockOrders(next));

  const getTemplateTab = (blockId: string): 'user' | 'assistant' =>
    activeTemplateTab[blockId] || 'user';

  const setTemplateTab = (blockId: string, tab: 'user' | 'assistant') =>
    setActiveTemplateTab((prev) => ({ ...prev, [blockId]: tab }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    const oldIndex = orderedBlocks.findIndex((b) => b.id === active.id);
    const newIndex = orderedBlocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    setBlocks(arrayMove(orderedBlocks, oldIndex, newIndex));
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateBlock = (id: string, updater: (block: ScenarioBlock) => ScenarioBlock) => {
    const next = orderedBlocks.map((b) => (b.id === id ? updater(b) : b));
    setBlocks(next);
  };

  const addBlock = (kind: 'range' | 'static') => {
    const id = safeUUID();
    const base: ScenarioBlock = {
      id,
      block_order: orderedBlocks.length,
      enabled: true,
      type: kind === 'range' ? 'rangeMapping' : 'staticPrompt',
    };

    const block: ScenarioBlock =
      kind === 'range'
        ? {
            ...base,
            type: 'rangeMapping',
            rangeMapping: { start_index: 0, end_index: -1, user_template: '', assistant_template: '' },
          }
        : {
            ...base,
            type: 'staticPrompt',
            staticPrompt: {
              role: 'user',
              template: '',
            },
          };

    setBlocks([...orderedBlocks, block]);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const duplicateBlock = (block: ScenarioBlock) => {
    const id = safeUUID();
    const clone: ScenarioBlock = JSON.parse(JSON.stringify(block));
    clone.id = id;
    clone.block_order = orderedBlocks.length;
    setBlocks([...orderedBlocks, clone]);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const deleteBlock = async (block: ScenarioBlock) => {
    setBlocks(orderedBlocks.filter((b) => b.id !== block.id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(block.id);
      return next;
    });
  };

  // Mini simulation state
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [simN, setSimN] = useState(1);
  const [simIncludeToolResults, setSimIncludeToolResults] = useState(true);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<any | null>(null);

  const runSimulation = async () => {
    setSimLoading(true);
    setSimError(null);
    try {
      const scenario: ScenarioDocument = {
        system_template: systemTemplate || '',
        blocks: normalizeBlockOrders(orderedBlocks),
      };
      const template_data = buildPreviewData({
        taskType,
        taskSubtype,
        injectedInputKey: null,
        showProjectContext: false,
        includeAllFilteredIds: false,
        projectId: currentProjectId,
      });
      const source_conversation = buildSampleConversation(simN, simIncludeToolResults);
      const result = await scenarioService.simulateScenario({
        task_type: taskType,
        task_subtype: taskSubtype,
        scenario,
        source_conversation,
        template_data,
      });
      setSimResult(result);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed');
      setSimResult(null);
    } finally {
      setSimLoading(false);
    }
  };

  const toolbarActions = (
    <HeaderOverflowMenu
      items={[
        ...(onOpenVersionHistory
          ? [{
              key: 'scenario-version-history',
              icon: <Clock size="sm" />,
              label: 'Version history',
              onClick: onOpenVersionHistory,
              disabled: versionHistoryDisabled,
              dividerAfter: true,
            }]
          : []),
        {
          key: 'simulate-scenario',
          icon: <Lightning size="sm" />,
          label: 'Simulate',
          onClick: () => setSimModalOpen(true),
        },
        {
          key: 'add-static-block',
          icon: <Plus size="sm" />,
          label: 'Add static block',
          onClick: () => addBlock('static'),
        },
        {
          key: 'add-range-block',
          icon: <Plus size="sm" />,
          label: 'Add range mapping',
          onClick: () => addBlock('range'),
        },
      ]}
    />
  );

  return (
    <div className="scenario-blocks-editor">
      {headerActionsRef?.current
        ? ReactDOM.createPortal(toolbarActions, headerActionsRef.current)
        : <div className="scenario-blocks-editor__toolbar">{toolbarActions}</div>
      }

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedBlocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="scenario-blocks-editor__list">
            {orderedBlocks.map((block, idx) => {
              const expandedNow = expanded.has(block.id);

              const headerLabel = (() => {
                if (block.type === 'staticPrompt') {
                  const role = block.staticPrompt?.role || 'user';
                  return `Static (${role})`;
                }
                const s = block.rangeMapping?.start_index ?? 0;
                const e = block.rangeMapping?.end_index ?? -1;
                return `Range Mapping (runs ${s}..${e})`;
              })();

              return (
                <SortableBlockCard
                  key={block.id}
                  block={block}
                >
                  <div className="scenario-block-card__header">
                    <div className="scenario-block-card__title">
                      <span className="scenario-block-card__index">#{idx}</span>
                      <span>{headerLabel}</span>
                    </div>
                    <div className="scenario-block-card__actions">
                      <ToggleSwitch
                        checked={block.enabled}
                        onChange={(v) => updateBlock(block.id, (b) => ({ ...b, enabled: v }))}
                        label=""
                        mode="bare"
                      />
                      <DropdownMenu
                        trigger={<IconButton icon={<MoreHorizontal size="sm" />} title="More" size="sm" variant="ghost" />}
                        align="right"
                      >
                        <DropdownItem
                          icon={<Copy size="sm" />}
                          label="Duplicate"
                          onClick={() => duplicateBlock(block)}
                        />
                        <DropdownDivider />
                        <DropdownItem
                          icon={<Trash size="sm" />}
                          label="Delete"
                          onClick={() => deleteBlock(block)}
                          variant="danger"
                        />
                      </DropdownMenu>
                    </div>
                  </div>

                  {!expandedNow && (
                    <div className="scenario-block-card__preview">
                      {block.type === 'staticPrompt' ? (
                        <span>{oneLinePreview(block.staticPrompt?.template || '')}</span>
                      ) : (
                        <span>
                          U: {oneLinePreview(block.rangeMapping?.user_template || '')} • A:{' '}
                          {oneLinePreview(block.rangeMapping?.assistant_template || '')}
                        </span>
                      )}
                    </div>
                  )}

                  {expandedNow && (
                    <div className="scenario-block-card__body">
                      {block.type === 'staticPrompt' && block.staticPrompt && (
                        <>
                          <div className="scenario-block-field-row">
                            <label>Role</label>
                            <select
                              value={block.staticPrompt.role}
                              onChange={(e) => {
                                const role = e.target.value === 'assistant' ? 'assistant' : 'user';
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  staticPrompt: { ...b.staticPrompt!, role },
                                }));
                              }}
                            >
                              <option value="user">user</option>
                              <option value="assistant">assistant</option>
                            </select>
                            <IconButton
                              icon={<Eye size="sm" />}
                              onClick={() =>
                                setPreview({
                                  open: true,
                                  content: block.staticPrompt?.template || '',
                                  injectedInputKey: null,
                                })
                              }
                              title="Preview"
                              size="sm"
                              variant="ghost"
                            />
                          </div>
                          <TemplateEditor
                            content={block.staticPrompt.template || ''}
                            onContentChange={(text) =>
                              updateBlock(block.id, (b) => ({
                                ...b,
                                staticPrompt: { ...b.staticPrompt!, template: text },
                              }))
                            }
                            validation={null}
                            isLoading={false}
                            placeholder="Enter template..."
                          />
                        </>
                      )}

                      {block.type === 'rangeMapping' && block.rangeMapping && (
                        <>
                          <div className="scenario-block-field-row">
                            <label>Start</label>
                            <NumberInput
                              value={block.rangeMapping.start_index}
                              onValueChange={(v) => {
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, start_index: v! },
                                }));
                              }}
                            />
                            <label>End</label>
                            <NumberInput
                              value={block.rangeMapping.end_index}
                              onValueChange={(v) => {
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, end_index: v! },
                                }));
                              }}
                            />
                          </div>

                          <div className="scenario-block-template-row">
                            <div className="scenario-block-template-toggle">
                              <button
                                type="button"
                                className={`scenario-block-template-toggle__btn ${getTemplateTab(block.id) === 'user' ? 'active' : ''}`}
                                onClick={() => setTemplateTab(block.id, 'user')}
                              >
                                User
                              </button>
                              <button
                                type="button"
                                className={`scenario-block-template-toggle__btn ${getTemplateTab(block.id) === 'assistant' ? 'active' : ''}`}
                                onClick={() => setTemplateTab(block.id, 'assistant')}
                              >
                                Assistant
                              </button>
                            </div>
                            <IconButton
                              icon={<Eye size="sm" />}
                              onClick={() => {
                                const isUser = getTemplateTab(block.id) === 'user';
                                const injectedInputKey = isUser
                                  ? (taskType === 'subAgent' ? 'agentMessage' : 'userMessage')
                                  : (taskType === 'subAgent' ? 'subAgentMessage' : 'agentMessage');
                                setPreview({
                                  open: true,
                                  content: isUser
                                    ? (block.rangeMapping?.user_template || '')
                                    : (block.rangeMapping?.assistant_template || ''),
                                  injectedInputKey,
                                });
                              }}
                              title="Preview"
                              size="sm"
                              variant="ghost"
                            />
                          </div>

                          {getTemplateTab(block.id) === 'user' ? (
                            <TemplateEditor
                              content={block.rangeMapping.user_template || ''}
                              onContentChange={(text) =>
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, user_template: text },
                                }))
                              }
                              validation={null}
                              isLoading={false}
                              placeholder="Enter user template..."
                            />
                          ) : (
                            <TemplateEditor
                              content={block.rangeMapping.assistant_template || ''}
                              onContentChange={(text) =>
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, assistant_template: text },
                                }))
                              }
                              validation={null}
                              isLoading={false}
                              placeholder="Enter assistant template..."
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div
                    className="scenario-block-card__expand-toggle"
                    onClick={() => toggleExpanded(block.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpanded(block.id);
                      }
                    }}
                  >
                    {expandedNow ? <ChevronUp size="sm" /> : <ChevronDown size="sm" />}
                  </div>
                </SortableBlockCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <BaseModal
        isOpen={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        title="Mini Simulation"
        size="medium"
      >
        <div className="scenario-simulation-modal__content">
          <div className="scenario-simulation-modal__controls">
            <label>
              N
              <select value={simN} onChange={(e) => setSimN(parseInt(e.target.value, 10) || 1)}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label className="scenario-simulation-modal__toggle">
              <input
                type="checkbox"
                checked={simIncludeToolResults}
                onChange={(e) => setSimIncludeToolResults(e.target.checked)}
              />
              Attach tool_results after assistant
            </label>
            <button
              type="button"
              className="scenario-simulation-modal__run"
              onClick={runSimulation}
              disabled={simLoading}
            >
              {simLoading ? 'Running...' : 'Run'}
            </button>
          </div>

          {simError && <div className="scenario-simulation-modal__error">{simError}</div>}

          {simResult && (
            <div className="scenario-simulation-modal__result">
              <details>
                <summary>Rendered system prompt</summary>
                <pre>{simResult.rendered_system_prompt}</pre>
              </details>

              <details open>
                <summary>Rendered conversation</summary>
                <div className="scenario-simulation-modal__messages">
                  {simResult.rendered_conversation?.map((m: any, i: number) => (
                    <div key={i} className={`scenario-sim-msg scenario-sim-msg--${m.role || 'unknown'}`}>
                      <div className="scenario-sim-msg__role">{m.role}</div>
                      <pre className="scenario-sim-msg__content">{JSON.stringify(m, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </details>

            </div>
          )}
        </div>
      </BaseModal>

      {preview.open && (
        <PromptPreviewModal
          isOpen={preview.open}
          onClose={() => setPreview((p) => ({ ...p, open: false }))}
          templateContent={preview.content}
          taskType={taskType}
          taskSubtype={taskSubtype}
          injectedInputKey={preview.injectedInputKey}
        />
      )}
    </div>
  );
};

export default ScenarioBlocksEditor;
