import React, { useState, useEffect } from 'react';
import PromptTreeNav from './PromptTreeNav';
import PromptEditor from './PromptEditor';
import FragmentsPanel from './FragmentsPanel';
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../IconButton';
import { ChevronLeft, ChevronRight, Document, Close } from '../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';

type SubTab = 'prompts' | 'fragments';

const PromptsTemplatesPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTab>('prompts');
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
    if (node.type === 'prompt') {
      setSelectedNode(node);
      // On mobile, collapse sidebar after selection
      if (window.innerWidth <= 768) {
        setIsSidebarCollapsed(true);
      }
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="prompts-layout">
      {/* Sub-tabs for Prompts and Fragments */}
      <div className="prompts-layout__tabs">
        <button
          className={`prompts-layout__tab-btn ${subTab === 'prompts' ? 'active' : ''}`}
          onClick={() => setSubTab('prompts')}
        >
          Prompts
        </button>
        <button
          className={`prompts-layout__tab-btn ${subTab === 'fragments' ? 'active' : ''}`}
          onClick={() => setSubTab('fragments')}
        >
          Prompt Fragments
        </button>
      </div>

      {/* Content based on selected sub-tab */}
      <div className="prompts-layout__content">
        {subTab === 'fragments' ? (
          <FragmentsPanel />
        ) : (
          <div className={`panel-split ${isSidebarCollapsed ? 'panel-split--collapsed' : ''}`}>
            {/* Mobile Backdrop */}
            {!isSidebarCollapsed && (
              <div className="panel-split__backdrop" onClick={() => setIsSidebarCollapsed(true)} />
            )}

            {/* Main Content Area */}
            <main className="panel-split__main">
              {selectedNode ? (
                <div className="editor-wrapper">
                  {/* Header */}
                  <header className="editor-wrapper__header">
                    <div className="editor-wrapper__title-group">
                      <h3 className="editor-wrapper__title">{selectedNode.label}</h3>
                      {selectedNode.description && (
                        <p className="editor-wrapper__description">
                          {selectedNode.description}
                        </p>
                      )}
                    </div>
                    <div className="editor-wrapper__actions">
                      <TemplateSyntaxHint selectedNode={selectedNode} />
                      <IconButton
                        icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                        onClick={toggleSidebar}
                        title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        size="sm"
                      />
                    </div>
                  </header>

                  {/* Editor Component */}
                  <div className="editor-wrapper__body">
                    <PromptEditor
                      key={`${selectedNode.functionType}-${selectedNode.category}-${selectedNode.name || ''}`}
                      functionType={selectedNode.functionType!}
                      category={selectedNode.category!}
                      name={selectedNode.name}
                      label={selectedNode.label}
                      description={selectedNode.description}
                    />
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon"><Document size="4xl" /></div>
                  <h3 className="empty-state__title">Select a prompt to edit</h3>
                  <p className="empty-state__text">Choose a prompt from the sidebar to view and edit its content</p>
                </div>
              )}
            </main>

            {/* Sidebar Navigation */}
            <aside className="panel-split__sidebar">
              <PromptTreeNav
                tree={PROMPT_TREE}
                selectedNodeId={selectedNode?.id || null}
                onNodeSelect={handleNodeSelect}
                onClose={() => setIsSidebarCollapsed(true)}
              />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptsTemplatesPanel;