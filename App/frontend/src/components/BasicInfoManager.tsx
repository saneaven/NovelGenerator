import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import type { BasicInfo } from '../types/storyObject';
import { createEmptyBasicInfo } from '../types/storyObject';

const BasicInfoManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getBasicInfo, updateBasicInfo } = useStoryObjectStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<BasicInfo>(createEmptyBasicInfo());
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Get basic info directly from store - this will automatically re-render when store updates
  const basicInfo = projectId ? (getBasicInfo(projectId) || createEmptyBasicInfo()) : createEmptyBasicInfo();

  const handleSave = () => {
    if (projectId) {
      updateBasicInfo(projectId, {
        title: editFormData.title,
        logline: editFormData.logline,
        genre: editFormData.genre,
      });
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditFormData(basicInfo);
    setIsEditing(false);
  };

  const handleChange = (field: keyof Pick<BasicInfo, 'title' | 'logline' | 'genre'>, value: string) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = () => {
    setEditFormData(basicInfo);
    setIsEditing(true);
  };

  const handleAIResult = (result: any) => {    
    if (!projectId) return;
    
    if (result && typeof result === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};
      
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;
      
      // Use AI-specific update function that automatically creates version
      const { updateBasicInfoAI } = useStoryObjectStore.getState();
      updateBasicInfoAI(projectId, updates);
    }
  };

  const handleRestoreVersion = (versionData: any) => {
    if (!projectId) return;
    
    if (versionData && typeof versionData === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};
      
      if (versionData.title !== undefined) updates.title = versionData.title;
      if (versionData.logline !== undefined) updates.logline = versionData.logline;
      if (versionData.genre !== undefined) updates.genre = versionData.genre;
      
      updateBasicInfo(projectId, updates);
    }
  };

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
      </div>
    );
  }

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>Basic Information</h2>
        {!isEditing ? (
          <div className="header-buttons">
            <button onClick={() => setShowVersionHistory(true)} className="version-history-button">
              📚 Version History
            </button>
            <button onClick={() => setShowAIModal(true)} className="ai-edit-button">
              🤖 AI Edit
            </button>
            <button onClick={handleEdit} className="edit-button">
              Edit
            </button>
          </div>
        ) : (
          <div className="edit-buttons">
            <button onClick={handleSave} className="save-button">
              Save
            </button>
            <button onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="basic-info-content">
        <div className="form-group">
          <label htmlFor="title">Title</label>
          {isEditing ? (
            <input
              id="title"
              type="text"
              value={editFormData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Enter the title of the novel"
            />
          ) : (
            <div className="display-value">
              {basicInfo.title || 'Title not set.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="genre">Genre</label>
          {isEditing ? (
            <input
              id="genre"
              type="text"
              value={editFormData.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              placeholder="Enter the genre (e.g., Fantasy, Romance, Sci-Fi)"
            />
          ) : (
            <div className="display-value">
              {basicInfo.genre || 'Genre not set.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="logline">Logline</label>
          {isEditing ? (
            <textarea
              id="logline"
              value={editFormData.logline}
              onChange={(e) => handleChange('logline', e.target.value)}
              placeholder="Summarize the core content of the novel in one or two sentences"
              rows={4}
            />
          ) : (
            <div className="display-value multiline">
              {basicInfo.logline || 'Logline not set.'}
            </div>
          )}
        </div>

        {basicInfo.updatedAt && (
          <div className="metadata">
            <p className="last-updated">
              Last updated: {basicInfo.updatedAt.toLocaleString()}
            </p>
          </div>
        )}
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="basicInfo"
        projectId={projectId || ''}
        targetId={basicInfo.id}
        onResult={handleAIResult}
      />

      {basicInfo.id && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          projectId={projectId || ''}
          category="basicInfo"
          targetId={basicInfo.id}
          onRestoreVersion={handleRestoreVersion}
        />
      )}
    </div>
  );
};

export default BasicInfoManager;