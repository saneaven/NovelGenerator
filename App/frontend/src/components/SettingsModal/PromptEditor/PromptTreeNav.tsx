import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptNode } from './promptTree';
import { Expand, Collapse, Close } from '../../icons';
import './PromptTreeNav.css';

interface PromptTreeNavProps {
  tree: PromptNode[];
  selectedNodeId: string | null;
  onNodeSelect: (node: PromptNode) => void;
  onClose?: () => void;
}

interface TreeNodeProps {
  node: PromptNode;
  level: number;
  selectedNodeId: string | null;
  expandedNodes: Set<string>;
  onNodeSelect: (node: PromptNode) => void;
  onToggleExpand: (nodeId: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  selectedNodeId,
  expandedNodes,
  onNodeSelect,
  onToggleExpand,
}) => {
  const isExpandable = node.type === 'category' || node.type === 'prompt';
  const isLeaf = node.type === 'promptView';
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = node.id === selectedNodeId;
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = () => {
    if (isExpandable) {
      onToggleExpand(node.id);
    } else if (isLeaf) {
      onNodeSelect(node);
    }
  };

  const typeClass = node.type === 'category'
    ? 'tree-node__content--category'
    : node.type === 'prompt'
      ? 'tree-node__content--prompt'
      : 'tree-node__content--prompt-view';

  return (
    <div className="tree-node">
      <div
        className={`tree-node__content ${typeClass} ${isSelected ? 'tree-node__content--selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={handleClick}
      >
        {isExpandable && (
          <span className="tree-node__expand-icon">
             {hasChildren ? (isExpanded ? <Collapse size="xs" /> : <Expand size="xs" />) : <span style={{ width: 12 }} />}
          </span>
        )}

        {node.icon && (
          <span className="tree-node__icon">{node.icon}</span>
        )}

        <span className="tree-node__label">{node.label}</span>
      </div>

      {isExpandable && hasChildren && isExpanded && (
        <div className="tree-node__children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedNodeId={selectedNodeId}
              expandedNodes={expandedNodes}
              onNodeSelect={onNodeSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const PromptTreeNav: React.FC<PromptTreeNavProps> = ({
  tree,
  selectedNodeId,
  onNodeSelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const collectDefaultExpanded = (nodes: PromptNode[]) => {
      nodes.forEach((node) => {
        if (node.defaultExpanded) {
          initial.add(node.id);
        }
        if (node.children) {
          collectDefaultExpanded(node.children);
        }
      });
    };
    collectDefaultExpanded(tree);
    return initial;
  });

  const handleToggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <nav className="tree-nav">
      <header className="tree-nav__header">
        <h3 className="tree-nav__title">{t('settings.promptEditor.prompts')}</h3>
        {onClose && (
          <button className="tree-nav__close-btn" onClick={onClose} aria-label={t('settings.promptEditor.treeNav.closeSidebar')}>
            <Close size="sm" />
          </button>
        )}
      </header>
      <div className="tree-nav__content">
        {tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            selectedNodeId={selectedNodeId}
            expandedNodes={expandedNodes}
            onNodeSelect={onNodeSelect}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
    </nav>
  );
};

export default PromptTreeNav;
