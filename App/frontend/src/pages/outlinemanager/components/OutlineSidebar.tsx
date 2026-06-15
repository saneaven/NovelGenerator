import React, { useState, useMemo, useEffect } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { alert as showAlert } from '../../../store/dialogStore';
import type { OutlineObject } from '../../../types/unifiedObject';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { Close, Plus, Edit, Trash, AIAssist, Books, MoreHorizontal, Refresh } from '../../../components/icons';
import { Warning } from '../../../components/icons';
import { requestedLanguageStateFromProjection } from '../../../utils/requestedLanguage';
import { sortOutlineObjects } from '../../../utils/outlineOrdering';
import './OutlineSidebar.css';

interface OutlineSidebarProps {
  projectId: string;
  selectedOutlineId: string | null;
  onSelectOutline: (outlineId: string) => void;
  displayLanguage: string;
  onEditOutline: (outlineId: string) => void;
  onTranslateOutline: (outlineId: string) => void;
  onRetranslateOutline: (outlineId: string) => void;
  onAIEditOutline: (outlineId: string) => void;
  onDeleteOutline: (outlineId: string) => void;
  canCreateOutline: boolean;
}

const OutlineSidebar: React.FC<OutlineSidebarProps> = ({
  projectId,
  selectedOutlineId,
  onSelectOutline,
  displayLanguage,
  onEditOutline,
  onTranslateOutline,
  onRetranslateOutline,
  onAIEditOutline,
  onDeleteOutline,
  canCreateOutline,
}) => {
  const store = useUnifiedObjectStore();
  const projectionObjects = useUnifiedObjectStore(
    (state) => state.getObjectsForProject(projectId, displayLanguage),
  );
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  useEffect(() => {
    if (canCreateOutline) return;
    setShowAddForm(false);
  }, [canCreateOutline]);

  const handleClose = () => {
    closeSidebar(projectId);
  };

  // Handle add outline form submission
  const handleAddOutline = async () => {
    if (!formName.trim() || !canCreateOutline) return;

    try {
      await store.createObject(
        'outline',
        projectId,
        { name: formName.trim(), description: formDescription.trim() },
        mainLanguage,
        { position: outlines.length },
        'User Creation',
        'outline'
      );
      // Reset form and close
      setFormName('');
      setFormDescription('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create outline:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create outline. Please try again.' });
    }
  };

  const handleCancelAdd = () => {
    setFormName('');
    setFormDescription('');
    setShowAddForm(false);
  };

  // Helper to get projection data.
  const getLocalizedData = <T extends { data: Record<string, any>; language_state?: { is_fallback?: boolean } }>(obj: T, fallback: any) => {
    void displayLanguage;
    void mainLanguage;
    return { data: obj.data ?? fallback, isFallback: Boolean(obj.language_state?.is_fallback) };
  };

  const getLanguageState = (outline: OutlineObject) => requestedLanguageStateFromProjection(outline.language_state, displayLanguage);

  // Get outlines from store (language projection)
  const outlines = useMemo(() => {
    return sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'outline' && obj.metadata?.project_id === projectId)
      )
    );
  }, [projectionObjects, projectId]);

  const handleOutlineSelect = (outlineId: string) => {
    onSelectOutline(outlineId);
    closeSidebar(projectId);
  };

  const headerContent = (
    <div className="outline-sidebar-header">
      <div className="header-title-group">
        <h3 className="header-title">Outlines</h3>
        <span className="header-subtitle">Select storyline</span>
      </div>
      <IconButton
        icon={<Close size="sm" />}
        onClick={handleClose}
        title="Close sidebar"
        className="close-button"
        size="sm"
        variant="ghost"
      />
    </div>
  );

  return (
    <BaseSidebar
      id="outline"
      projectId={projectId}
      position="right"
      className="outline-sidebar"
      header={headerContent}
      onClose={handleClose}
    >
      <div className="outline-list-container">
        {/* Add Outline Form */}
        {showAddForm && canCreateOutline && (
          <div className="sidebar-add-form">
            <h4>Add New Outline</h4>
            <div className="form-group">
              <label htmlFor="sidebar-outline-name">Outline Title</label>
              <input
                id="sidebar-outline-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Main Story, Side Plot A"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="sidebar-outline-desc">Description (Optional)</label>
              <textarea
                id="sidebar-outline-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the overall structure..."
                rows={3}
              />
            </div>
            <div className="form-actions">
              <TextButton variant="ghost" size="sm" onClick={handleCancelAdd}>
                Cancel
              </TextButton>
              <TextButton variant="secondary" size="sm" onClick={handleAddOutline} disabled={!formName.trim()}>
                Create Outline
              </TextButton>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!showAddForm && outlines.length === 0 && (
          <div className="empty-state">
            <div className="empty-content">
              <Books size="lg" className="empty-icon" />
              <h4>No Outlines Yet</h4>
              <p>
                {canCreateOutline
                  ? 'Create your first outline to start organizing your story.'
                  : `Create outlines in ${mainLanguage}, then translate them into ${displayLanguage}.`}
              </p>
              {canCreateOutline ? (
                <TextButton onClick={() => setShowAddForm(true)} iconLeft={<Plus size="xs" />} size="sm">
                  Create Outline
                </TextButton>
              ) : null}
            </div>
          </div>
        )}

        {/* Outline List */}
        {!showAddForm && outlines.length > 0 && (
          <>
            <div className="outline-list">
              {outlines.map((outline, index) => {
                const { data: outlineData, isFallback } = getLocalizedData(outline, { name: 'Untitled Outline', description: '' });
                const languageState = getLanguageState(outline);
                const isSelected = selectedOutlineId === outline.id;
                const actsCount = Object.values(projectionObjects).filter(
                  obj => obj?.type === 'outline' && obj?.kind === 'act' && obj?.metadata?.parent_id === outline.id
                ).length;

                return (
                  <div
                    key={outline.id}
                    className={`outline-list-item ${isSelected ? 'is-active' : ''}`}
                    style={{ '--anim-index': index } as React.CSSProperties}
                  >
                    <button
                      className="outline-card"
                      onClick={() => handleOutlineSelect(outline.id)}
                    >
                      <div className="outline-card-header">
                        <span className="outline-number">#{index + 1}</span>
                        <span className="acts-count">{actsCount} Acts</span>
                      </div>
                      <div className="outline-card-main">
                        <span className="outline-name">
                          {outlineData.name || 'Untitled Outline'}
                          {isFallback && <Warning size="xs" className="warning-icon" />}
                        </span>
                      </div>
                      {outlineData.description && (
                        <div className="outline-card-description">
                          {outlineData.description}
                        </div>
                      )}
                    </button>
                    <div className="outline-item-actions">
                      <DropdownMenu
                        trigger={
                          <IconButton
                            icon={<MoreHorizontal size="xs" />}
                            size="xs"
                            variant="ghost"
                          />
                        }
                      >
                        {languageState.canEdit ? (
                          <DropdownItem icon={<Edit size="sm" />} label="Edit" onClick={() => onEditOutline(outline.id)} />
                        ) : (
                          <DropdownItem icon={<Edit size="sm" />} label="Translate" onClick={() => onTranslateOutline(outline.id)} />
                        )}
                        {languageState.isTranslationView && (
                          <DropdownItem icon={<Refresh size="sm" />} label="Retranslate" onClick={() => onRetranslateOutline(outline.id)} />
                        )}
                        {languageState.isMainLanguage && (
                          <DropdownItem icon={<AIAssist size="sm" />} label="AI Edit" onClick={() => onAIEditOutline(outline.id)} />
                        )}
                        <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => onDeleteOutline(outline.id)} variant="danger" />
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
            {canCreateOutline ? (
              <div className="outline-list-footer">
                <TextButton onClick={() => setShowAddForm(true)} iconLeft={<Plus size="xs" />} size="sm" variant="ghost">
                  Add Outline
                </TextButton>
              </div>
            ) : null}
          </>
        )}
      </div>
    </BaseSidebar>
  );
};

export default OutlineSidebar;
