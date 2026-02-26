import React, { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, Collapse, Copy, Expand, Eye, HamburgerMenu, Plus, Trash } from '../../icons';
import { IconButton } from '../../IconButton';
import { DropdownMenu, DropdownItem } from '../../ui/DropdownMenu';
import ToggleSwitch from '../../common/ToggleSwitch';
import TemplateEditor from './TemplateEditor';
import PromptPreviewModal from './PromptPreviewModal';
import { buildPreviewData } from './previewDataBuilder';
import { scenarioService } from '../../../api/scenarioService';
import { useProjectStore } from '../../../store/projectStore';
import type { ScenarioBlock, ScenarioDocument, StaticPromptSubtype, TaskType } from '../../../types/scenarios';
import { confirm } from '../../../store/dialogStore';
import './ScenarioBlocksEditor.css';

type ToastKind = 'success' | 'warning' | 'error';

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

function isPinned(block: ScenarioBlock): boolean {
  if (block.type !== 'staticPrompt') return false;
  const subtype = block.staticPrompt?.subtype;
  return subtype === 'memory';
}

function getStaticSubtypeLabel(subtype: StaticPromptSubtype): string {
  if (subtype === 'memory') return 'Memory';
  return 'Static';
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

const SortableBlockCard: React.FC<{
  block: ScenarioBlock;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ block, children, disabled }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`scenario-block-card ${isPinned(block) ? 'is-pinned' : ''}`}>
      <div className="scenario-block-card__drag-handle" {...attributes} {...listeners}>
        <HamburgerMenu size="sm" />
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
  onToast?: (kind: ToastKind, message: string) => void;
}

const ScenarioBlocksEditor: React.FC<ScenarioBlocksEditorProps> = ({
  taskType,
  taskSubtype,
  systemTemplate,
  blocks,
  onBlocksChange,
  onToast,
}) => {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const orderedBlocks = useMemo(() => {
    const list = [...(blocks || [])];
    list.sort((a, b) => (a.block_order ?? 0) - (b.block_order ?? 0));
    return list;
  }, [blocks]);

  const hasMemory = useMemo(
    () => orderedBlocks.some((b) => b.type === 'staticPrompt' && b.staticPrompt?.subtype === 'memory'),
    [orderedBlocks]
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<{
    open: boolean;
    content: string;
    injectedInputKey: 'userMessage' | 'agentMessage' | 'subAgentMessage' | null;
    isMemoryPrompt: boolean;
  }>({ open: false, content: '', injectedInputKey: null, isMemoryPrompt: false });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const setBlocks = (next: ScenarioBlock[]) => onBlocksChange(normalizeBlockOrders(next));

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

  const addBlock = (kind: 'range' | 'static' | 'memory') => {
    if (kind === 'memory' && hasMemory) {
      onToast?.('warning', 'Memory block already exists.');
      return;
    }

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
              subtype: kind === 'memory' ? 'memory' : 'normal',
              role: 'user',
              template: '',
            },
          };

    setBlocks([...orderedBlocks, block]);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const duplicateBlock = (block: ScenarioBlock) => {
    if (isPinned(block)) {
      onToast?.('warning', 'Pinned blocks cannot be duplicated.');
      return;
    }
    const id = safeUUID();
    const clone: ScenarioBlock = JSON.parse(JSON.stringify(block));
    clone.id = id;
    clone.block_order = orderedBlocks.length;
    setBlocks([...orderedBlocks, clone]);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const deleteBlock = async (block: ScenarioBlock) => {
    if (isPinned(block)) {
      const ok = await confirm({
        title: 'Delete Pinned Block',
        message: 'Delete this pinned block?',
        variant: 'danger',
        confirmLabel: 'Delete',
      });
      if (!ok) return;
    }
    setBlocks(orderedBlocks.filter((b) => b.id !== block.id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(block.id);
      return next;
    });
  };

  // Mini simulation state
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
        isMemoryPrompt: false,
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

  return (
    <div className="scenario-blocks-editor">
      <div className="scenario-blocks-editor__toolbar">
        <DropdownMenu
          trigger={<IconButton icon={<Plus size="sm" />} title="Add block" size="sm" />}
          align="left"
        >
          <DropdownItem label="Static Block" onClick={() => addBlock('static')} />
          <DropdownItem label="Range Mapping" onClick={() => addBlock('range')} />
          <DropdownItem label="Memory Block" onClick={() => addBlock('memory')} disabled={hasMemory} />
        </DropdownMenu>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedBlocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="scenario-blocks-editor__list">
            {orderedBlocks.map((block, idx) => {
              const expandedNow = expanded.has(block.id);
              const pinned = isPinned(block);

              const headerLabel = (() => {
                if (block.type === 'staticPrompt') {
                  const subtype = block.staticPrompt?.subtype || 'normal';
                  const role = block.staticPrompt?.role || 'user';
                  return `${getStaticSubtypeLabel(subtype as StaticPromptSubtype)} (${role})`;
                }
                const s = block.rangeMapping?.start_index ?? 0;
                const e = block.rangeMapping?.end_index ?? -1;
                return `Range Mapping (runs ${s}..${e})`;
              })();

              return (
                <SortableBlockCard key={block.id} block={block} disabled={pinned}>
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
                      />
                      <IconButton
                        icon={<ChevronUp size="sm" />}
                        onClick={() => setBlocks(arrayMove(orderedBlocks, idx, Math.max(0, idx - 1)))}
                        title="Move up"
                        size="sm"
                        variant="ghost"
                        disabled={pinned || idx === 0}
                      />
                      <IconButton
                        icon={<ChevronDown size="sm" />}
                        onClick={() => setBlocks(arrayMove(orderedBlocks, idx, Math.min(orderedBlocks.length - 1, idx + 1)))}
                        title="Move down"
                        size="sm"
                        variant="ghost"
                        disabled={pinned || idx === orderedBlocks.length - 1}
                      />
                      <IconButton
                        icon={expandedNow ? <Collapse size="sm" /> : <Expand size="sm" />}
                        onClick={() => toggleExpanded(block.id)}
                        title={expandedNow ? 'Collapse' : 'Edit'}
                        size="sm"
                        variant="ghost"
                      />
                      <IconButton
                        icon={<Copy size="sm" />}
                        onClick={() => duplicateBlock(block)}
                        title="Duplicate"
                        size="sm"
                        variant="ghost"
                        disabled={pinned}
                      />
                      <IconButton
                        icon={<Trash size="sm" />}
                        onClick={() => deleteBlock(block)}
                        title="Delete"
                        size="sm"
                        variant="ghost"
                      />
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
                              disabled={block.staticPrompt.subtype === 'memory'}
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
                                  isMemoryPrompt: block.staticPrompt?.subtype === 'memory',
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
                            <input
                              type="number"
                              value={block.rangeMapping.start_index}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (Number.isNaN(v)) return;
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, start_index: v },
                                }));
                              }}
                            />
                            <label>End</label>
                            <input
                              type="number"
                              value={block.rangeMapping.end_index}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (Number.isNaN(v)) return;
                                updateBlock(block.id, (b) => ({
                                  ...b,
                                  rangeMapping: { ...b.rangeMapping!, end_index: v },
                                }));
                              }}
                            />
                          </div>

                          <div className="scenario-block-field-header">
                            <span>User Template</span>
                            <IconButton
                              icon={<Eye size="sm" />}
                              onClick={() => {
                                const injectedInputKey = taskType === 'subAgent' ? 'agentMessage' : 'userMessage';
                                setPreview({
                                  open: true,
                                  content: block.rangeMapping?.user_template || '',
                                  injectedInputKey,
                                  isMemoryPrompt: false,
                                });
                              }}
                              title="Preview"
                              size="sm"
                              variant="ghost"
                            />
                          </div>
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

                          <div className="scenario-block-field-header">
                            <span>Assistant Template</span>
                            <IconButton
                              icon={<Eye size="sm" />}
                              onClick={() => {
                                const injectedInputKey = taskType === 'subAgent' ? 'subAgentMessage' : 'agentMessage';
                                setPreview({
                                  open: true,
                                  content: block.rangeMapping?.assistant_template || '',
                                  injectedInputKey,
                                  isMemoryPrompt: false,
                                });
                              }}
                              title="Preview"
                              size="sm"
                              variant="ghost"
                            />
                          </div>
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
                        </>
                      )}
                    </div>
                  )}
                </SortableBlockCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="scenario-blocks-editor__simulation">
        <div className="scenario-blocks-editor__simulation-header">
          <strong>Mini Simulation</strong>
          <span className="scenario-blocks-editor__simulation-hint">N = number of runs</span>
        </div>
        <div className="scenario-blocks-editor__simulation-controls">
          <label>
            N
            <select value={simN} onChange={(e) => setSimN(parseInt(e.target.value, 10) || 1)}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label className="scenario-blocks-editor__simulation-toggle">
            <input
              type="checkbox"
              checked={simIncludeToolResults}
              onChange={(e) => setSimIncludeToolResults(e.target.checked)}
            />
            Attach tool_results after assistant
          </label>
          <button type="button" className="scenario-blocks-editor__simulation-run" onClick={runSimulation} disabled={simLoading}>
            {simLoading ? 'Running…' : 'Run'}
          </button>
        </div>

        {simError && <div className="scenario-blocks-editor__simulation-error">{simError}</div>}

        {simResult && (
          <div className="scenario-blocks-editor__simulation-result">
            <details>
              <summary>Rendered system prompt</summary>
              <pre>{simResult.rendered_system_prompt}</pre>
            </details>

            <details open>
              <summary>Rendered conversation</summary>
              <div className="scenario-blocks-editor__simulation-messages">
                {simResult.rendered_conversation?.map((m: any, i: number) => (
                  <div key={i} className={`scenario-sim-msg scenario-sim-msg--${m.role || 'unknown'}`}>
                    <div className="scenario-sim-msg__role">{m.role}</div>
                    <pre className="scenario-sim-msg__content">{JSON.stringify(m, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </details>

            <details>
              <summary>Memory template</summary>
              <pre>{simResult.memory_template ?? '(null)'}</pre>
            </details>
          </div>
        )}
      </div>

      {preview.open && (
        <PromptPreviewModal
          isOpen={preview.open}
          onClose={() => setPreview((p) => ({ ...p, open: false }))}
          templateContent={preview.content}
          taskType={taskType}
          taskSubtype={taskSubtype}
          injectedInputKey={preview.injectedInputKey}
          isMemoryPrompt={preview.isMemoryPrompt}
        />
      )}
    </div>
  );
};

export default ScenarioBlocksEditor;
