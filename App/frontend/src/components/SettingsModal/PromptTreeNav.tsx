import React, { useState } from 'react';
import type { PromptNode } from './promptTree';
import './PromptTreeNav.css';

interface PromptTreeNavProps {
  tree: PromptNode[];
  selectedNodeId: string | null;
  onNodeSelect: (node: PromptNode) => void;
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
  const isCategory = node.type === 'category';
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = node.id === selectedNodeId;
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = () => {
    if (isCategory) {
      // Toggle expand/collapse for categories
      onToggleExpand(node.id);
    } else {
      // Select prompt nodes
      onNodeSelect(node);
    }
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node-content ${isCategory ? 'category' : 'prompt'} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse icon for categories */}
        {isCategory && hasChildren && (
          <span className="tree-node-expand-icon">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}

        {/* Icon */}
        {node.icon && (
          <span className="tree-node-icon">{node.icon}</span>
        )}

        {/* Label */}
        <span className="tree-node-label">{node.label}</span>

        {/* Bullet for prompt nodes */}
        {!isCategory && (
          <span className="tree-node-bullet">•</span>
        )}
      </div>

      {/* Render children if category is expanded */}
      {isCategory && hasChildren && isExpanded && (
        <div className="tree-node-children">
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
}) => {
  // Track which category nodes are expanded
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const initial = new Set<string>();

    // Auto-expand nodes marked as defaultExpanded
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
    <div className="prompt-tree-nav">
      <div className="prompt-tree-header">
        <h3>Prompts</h3>
      </div>
      <div className="prompt-tree-content">
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
    </div>
  );
};

export default PromptTreeNav;
