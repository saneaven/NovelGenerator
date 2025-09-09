import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import type { BasicInfo } from '../types/storyObject';
import { createEmptyBasicInfo } from '../types/storyObject';

const BasicInfoManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getBasicInfo, updateBasicInfo } = useStoryObjectStore();
  const [basicInfo, setBasicInfo] = useState<BasicInfo>(createEmptyBasicInfo());
  const [isEditing, setIsEditing] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  useEffect(() => {
    if (projectId) {
      const storedBasicInfo = getBasicInfo(projectId);
      if (storedBasicInfo) {
        setBasicInfo(storedBasicInfo);
      }
    }
  }, [projectId, getBasicInfo]);

  const handleSave = () => {
    if (projectId) {
      updateBasicInfo(projectId, {
        title: basicInfo.title,
        logline: basicInfo.logline,
        genre: basicInfo.genre,
      });
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    if (projectId) {
      const storedBasicInfo = getBasicInfo(projectId);
      if (storedBasicInfo) {
        setBasicInfo(storedBasicInfo);
      } else {
        setBasicInfo(createEmptyBasicInfo());
      }
    }
    setIsEditing(false);
  };

  const handleChange = (field: keyof Pick<BasicInfo, 'title' | 'logline' | 'genre'>, value: string) => {
    setBasicInfo(prev => ({ ...prev, [field]: value }));
  };

  const handleAIResult = (result: any) => {
    console.log('[BasicInfo] AI result received:', result);
    console.log('[BasicInfo] projectId:', projectId);
    
    if (!projectId) return;
    
    if (result && typeof result === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};
      
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;
      
      console.log('[BasicInfo] Content to update:', updates);
      updateBasicInfo(projectId, updates);
      
      // Refresh the local state
      const updatedBasicInfo = getBasicInfo(projectId);
      console.log('[BasicInfo] Data after update:', updatedBasicInfo);
      if (updatedBasicInfo) {
        setBasicInfo(updatedBasicInfo);
      }
    } else {
      console.log('[BasicInfo] Invalid result data format:', result);
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
      
      // Refresh the local state
      const updatedBasicInfo = getBasicInfo(projectId);
      if (updatedBasicInfo) {
        setBasicInfo(updatedBasicInfo);
      }
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
            <button onClick={() => setIsEditing(true)} className="edit-button">
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
              value={basicInfo.title}
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
              value={basicInfo.genre}
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
              value={basicInfo.logline}
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