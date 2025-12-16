import React, { useState, useEffect } from 'react';
import PromptTreeNav from './PromptTreeNav';
import PromptEditor from './PromptEditor';
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../IconButton';
import { ChevronLeft, ChevronRight, Document } from '../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';

const PromptsTemplatesPanel: React.FC = () => {
  // Select the first prompt by default
  const [selectedNode, setSelectedNode] = useState<PromptNode | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Initialize with first prompt on mount
  useEffect(() => {
    const firstPrompt = getFirstPromptNode();
    if (firstPrompt) {
      setSelectedNode(firstPrompt);
    }
  }, []);

  const handleNodeSelect = (node: PromptNode) => {
    // Only select prompt nodes, not categories
    if (node.type === 'prompt') {
      setSelectedNode(node);
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className={`prompts-templates-panel ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Left content: Prompt editor */}
      <div className="prompts-content">
        <div className="prompts-content-body">
          {selectedNode ? (
            <div className="prompts-editor-container">
              {/* Header with description */}
              <div className="prompts-editor-header">
                <div className="prompts-editor-header-text">
                  <h3>{selectedNode.label}</h3>
                  {selectedNode.description && (
                    <p className="prompts-editor-description">
                      {selectedNode.description}
                    </p>
                  )}
                </div>
                <div className="prompts-editor-header-actions">
                  <TemplateSyntaxHint selectedNode={selectedNode} />
                  <IconButton
                    icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                    onClick={toggleSidebar}
                    title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    size="sm"
                  />
                </div>
              </div>

              {/* Prompt editor */}
                <PromptEditor
                  key={`${selectedNode.functionType}-${selectedNode.category}-${selectedNode.name || ''}`}
                  functionType={selectedNode.functionType!}
                  category={selectedNode.category!}
                  name={selectedNode.name}
                  label={selectedNode.label}
                  description={selectedNode.description}
                />
            </div>
          ) : (
            <div className="prompts-empty-state">
              <div className="empty-state-icon"><Document size="4xl" /></div>
              <h3>Select a prompt to edit</h3>
              <p>Choose a prompt from the sidebar to view and edit its content</p>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar: Tree navigation */}
      <div className="prompts-sidebar">
        <PromptTreeNav
          tree={PROMPT_TREE}
          selectedNodeId={selectedNode?.id || null}
          onNodeSelect={handleNodeSelect}
        />
      </div>
    </div>
  );
};

export default PromptsTemplatesPanel;
