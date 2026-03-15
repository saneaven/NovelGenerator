import React, { useEffect } from 'react';
import { useVariableStore } from '../../../store/variableStore';
import type { PromptVariable, VariableType } from '../../../types/variables';
import { Plus, Text, Hash, Toggle, List, GripVertical } from '../../icons';
import { TextButton } from '../../TextButton';
import './VariableListNav.css';

interface VariableListNavProps {
  selectedId: string | null;
  onVariableSelect: (id: string) => void;
  onCreateVariable: () => void;
  newDraftLabel?: string | null;
  isNewDraftSelected?: boolean;
  onSelectNewDraft?: () => void;
}

const getTypeIcon = (type: VariableType) => {
  switch (type) {
    case 'string':
      return <Text size="sm" />;
    case 'number':
      return <Hash size="sm" />;
    case 'boolean':
      return <Toggle size="sm" />;
    case 'select':
      return <List size="sm" />;
    default:
      return <Text size="sm" />;
  }
};

const getTypeLabel = (type: VariableType): string => {
  switch (type) {
    case 'string':
      return 'Text';
    case 'number':
      return 'Number';
    case 'boolean':
      return 'Toggle';
    case 'select':
      return 'Dropdown';
    default:
      return type;
  }
};

interface VariableItemProps {
  variable: PromptVariable;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
}

const VariableItem: React.FC<VariableItemProps> = ({
  variable,
  isSelected,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  return (
    <div
      className={`variable-item ${isSelected ? 'variable-item--selected' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={(e) => onDragStart(e, variable.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, variable.id)}
    >
      <span className="variable-item__grip">
        <GripVertical size="sm" />
      </span>
      <span className="variable-item__icon">
        {getTypeIcon(variable.var_type)}
      </span>
      <span className="variable-item__name">{variable.name}</span>
      <span className="variable-item__type">{getTypeLabel(variable.var_type)}</span>
    </div>
  );
};

const VariableListNav: React.FC<VariableListNavProps> = ({
  selectedId,
  onVariableSelect,
  onCreateVariable,
  newDraftLabel,
  isNewDraftSelected,
  onSelectNewDraft,
}) => {
  const { variables, isLoading, loadVariables, reorderVariables } = useVariableStore();
  const [draggedId, setDraggedId] = React.useState<string | null>(null);

  useEffect(() => {
    loadVariables();
  }, [loadVariables]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const currentOrder = variables.map((v) => v.id);
    const draggedIndex = currentOrder.indexOf(draggedId);
    const targetIndex = currentOrder.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedId(null);
      return;
    }

    // Remove dragged item and insert at target position
    const newOrder = [...currentOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedId);

    reorderVariables(newOrder);
    setDraggedId(null);
  };

  if (isLoading && variables.length === 0) {
    return (
      <div className="variable-list-nav">
        <div className="variable-list-nav__loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="variable-list-nav">
      <div className="variable-list-nav__list">
        {newDraftLabel && (
          <button
            type="button"
            className={`variable-item variable-item--draft ${isNewDraftSelected ? 'variable-item--selected' : ''}`}
            onClick={onSelectNewDraft}
          >
            <span className="variable-item__grip">
              <GripVertical size="sm" />
            </span>
            <span className="variable-item__icon">
              <Plus size="sm" />
            </span>
            <span className="variable-item__name">{newDraftLabel}</span>
            <span className="variable-item__type">Unsaved</span>
          </button>
        )}
        {variables.length === 0 ? (
          <div className="variable-list-nav__empty">
            <p>No variables defined yet.</p>
            <p className="variable-list-nav__empty-hint">
              Create variables to use in your prompts with {'{{variables.name}}'} syntax.
            </p>
          </div>
        ) : (
          variables.map((variable) => (
            <VariableItem
              key={variable.id}
              variable={variable}
              isSelected={selectedId === variable.id}
              onSelect={() => onVariableSelect(variable.id)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))
        )}
      </div>

      <div className="variable-list-nav__footer">
        <TextButton
          iconLeft={<Plus size="sm" />}
          onClick={onCreateVariable}
        >
          Add Variable
        </TextButton>
      </div>
    </div>
  );
};

export default VariableListNav;
