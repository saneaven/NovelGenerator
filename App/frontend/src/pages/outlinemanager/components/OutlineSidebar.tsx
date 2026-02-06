import React, { useState, useMemo } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import type { OutlineObject } from '../../../types/unifiedObject';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { Close, Plus, Edit, Trash, AIAssist, Books, MoreHorizontal } from '../../../components/icons';
import { Warning } from '../../../components/icons';
import './OutlineSidebar.css';

interface OutlineSidebarProps {
  projectId: string;
  selectedOutlineId: string | null;
  onSelectOutline: (outlineId: string) => void;
  displayLanguage: string;
  onEditOutline: (outlineId: string) => void;
  onAIEditOutline: (outlineId: string) => void;
  onDeleteOutline: (outlineId: string) => void;
}

const OutlineSidebar: React.FC<OutlineSidebarProps> = ({
  projectId,
  selectedOutlineId,
  onSelectOutline,
  displayLanguage,
  onEditOutline,
  onAIEditOutline,
  onDeleteOutline,
}) => {
  const store = useUnifiedObjectStore();
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const { showError } = useErrorStore();

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const handleClose = () => {
    closeSidebar(projectId);
  };

  // Handle add outline form submission
  const handleAddOutline = async () => {
    if (!formName.trim()) return;

    try {
      const outlineOrder = outlines.length;
      await store.createObject(
        'outline',
        projectId,
        { name: formName.trim(), description: formDescription.trim() },
        mainLanguage,
        { order: outlineOrder }
      );
      // Reset form and close
      setFormName('');
      setFormDescription('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create outline:', error);
      showError('Create Error', 'Failed to create outline. Please try again.');
    }
  };

  const handleCancelAdd = () => {
    setFormName('');
    setFormDescription('');
    setShowAddForm(false);
  };

  // Helper to get data with fallback
  const getLocalizedData = <T extends { data: Record<string, any> }>(obj: T, fallback: any) => {
    if (obj.data[displayLanguage]) return { data: obj.data[displayLanguage], isFallback: false };
    if (obj.data[mainLanguage]) return { data: obj.data[mainLanguage], isFallback: true };
    const available = Object.keys(obj.data);
    return available.length > 0
      ? { data: obj.data[available[0]], isFallback: true }
      : { data: fallback, isFallback: true };
  };

  // Get outlines from store
  const outlines = useMemo(() => {
    return Object.values(store.objects)
      .filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

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
        {showAddForm && (
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
              <p>Create your first outline to start organizing your story.</p>
              <TextButton onClick={() => setShowAddForm(true)} iconLeft={<Plus size="xs" />} size="sm">
                Create Outline
              </TextButton>
            </div>
          </div>
        )}

        {/* Outline List */}
        {!showAddForm && outlines.length > 0 && (
          <>
            <div className="outline-list">
              {outlines.map((outline, index) => {
                const { data: outlineData, isFallback } = getLocalizedData(outline, { name: 'Untitled Outline', description: '' });
                const isSelected = selectedOutlineId === outline.id;
                const actsCount = Object.values(store.objects).filter(
                  obj => obj?.type === 'act' && obj?.metadata?.outline_id === outline.id
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
                        <DropdownItem icon={<Edit size="sm" />} label="Edit" onClick={() => onEditOutline(outline.id)} />
                        <DropdownItem icon={<AIAssist size="sm" />} label="AI Edit" onClick={() => onAIEditOutline(outline.id)} />
                        <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => onDeleteOutline(outline.id)} variant="danger" />
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="outline-list-footer">
              <TextButton onClick={() => setShowAddForm(true)} iconLeft={<Plus size="xs" />} size="sm" variant="ghost">
                Add Outline
              </TextButton>
            </div>
          </>
        )}
      </div>
    </BaseSidebar>
  );
};

export default OutlineSidebar;
