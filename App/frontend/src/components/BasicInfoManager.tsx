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
    console.log('[BasicInfo] AI 결과 받음:', result);
    console.log('[BasicInfo] projectId:', projectId);
    
    if (!projectId) return;
    
    if (result && typeof result === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};
      
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;
      
      console.log('[BasicInfo] 업데이트할 내용:', updates);
      updateBasicInfo(projectId, updates);
      
      // Refresh the local state
      const updatedBasicInfo = getBasicInfo(projectId);
      console.log('[BasicInfo] 업데이트 후 데이터:', updatedBasicInfo);
      if (updatedBasicInfo) {
        setBasicInfo(updatedBasicInfo);
      }
    } else {
      console.log('[BasicInfo] 결과 데이터 형식이 잘못됨:', result);
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
        <p>프로젝트 ID를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>기본 정보</h2>
        {!isEditing ? (
          <div className="header-buttons">
            <button onClick={() => setShowVersionHistory(true)} className="version-history-button">
              📚 버전 히스토리
            </button>
            <button onClick={() => setShowAIModal(true)} className="ai-edit-button">
              🤖 AI 편집
            </button>
            <button onClick={() => setIsEditing(true)} className="edit-button">
              편집
            </button>
          </div>
        ) : (
          <div className="edit-buttons">
            <button onClick={handleSave} className="save-button">
              저장
            </button>
            <button onClick={handleCancel} className="cancel-button">
              취소
            </button>
          </div>
        )}
      </div>

      <div className="basic-info-content">
        <div className="form-group">
          <label htmlFor="title">제목</label>
          {isEditing ? (
            <input
              id="title"
              type="text"
              value={basicInfo.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="소설의 제목을 입력하세요"
            />
          ) : (
            <div className="display-value">
              {basicInfo.title || '제목이 설정되지 않았습니다.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="genre">장르</label>
          {isEditing ? (
            <input
              id="genre"
              type="text"
              value={basicInfo.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              placeholder="장르를 입력하세요 (예: 판타지, 로맨스, SF)"
            />
          ) : (
            <div className="display-value">
              {basicInfo.genre || '장르가 설정되지 않았습니다.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="logline">로그라인</label>
          {isEditing ? (
            <textarea
              id="logline"
              value={basicInfo.logline}
              onChange={(e) => handleChange('logline', e.target.value)}
              placeholder="소설의 핵심 내용을 한두 문장으로 요약해주세요"
              rows={4}
            />
          ) : (
            <div className="display-value multiline">
              {basicInfo.logline || '로그라인이 설정되지 않았습니다.'}
            </div>
          )}
        </div>

        {basicInfo.updatedAt && (
          <div className="metadata">
            <p className="last-updated">
              마지막 수정: {basicInfo.updatedAt.toLocaleString()}
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