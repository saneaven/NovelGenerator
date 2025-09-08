import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import BasicInfoManager from '../components/BasicInfoManager';
import NameDescriptionManager from '../components/NameDescriptionManager';
import OutlineManager from '../components/OutlineManager';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

const StoryObjects: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const [activeTab, setActiveTab] = useState<TabType>('basicInfo');

  const currentProject = getCurrentProject();

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>프로젝트를 찾을 수 없습니다</h2>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'basicInfo', label: '기본 정보', icon: '📋' },
    { id: 'characters', label: '등장인물', icon: '👥' },
    { id: 'organizations', label: '조직/단체', icon: '🏛️' },
    { id: 'locations', label: '장소', icon: '🗺️' },
    { id: 'lorebook', label: '로어북', icon: '📚' },
    { id: 'outline', label: '아웃라인', icon: '📝' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'basicInfo':
        return <BasicInfoManager />;
      case 'characters':
        return (
          <NameDescriptionManager
            category="character"
            title="등장인물"
            singularName="등장인물"
            pluralName="등장인물"
            placeholder={{
              name: '등장인물 이름을 입력하세요',
              description: '등장인물의 외모, 성격, 배경 등을 설명하세요'
            }}
          />
        );
      case 'organizations':
        return (
          <NameDescriptionManager
            category="organization"
            title="조직/단체"
            singularName="조직"
            pluralName="조직"
            placeholder={{
              name: '조직명을 입력하세요',
              description: '조직의 목적, 구조, 역할 등을 설명하세요'
            }}
          />
        );
      case 'locations':
        return (
          <NameDescriptionManager
            category="location"
            title="장소"
            singularName="장소"
            pluralName="장소"
            placeholder={{
              name: '장소명을 입력하세요',
              description: '장소의 특징, 분위기, 중요성 등을 설명하세요'
            }}
          />
        );
      case 'lorebook':
        return (
          <NameDescriptionManager
            category="lorebook"
            title="로어북"
            singularName="항목"
            pluralName="항목"
            placeholder={{
              name: '용어나 개념명을 입력하세요',
              description: '이 용어나 개념에 대한 자세한 설명을 작성하세요'
            }}
          />
        );
      case 'outline':
        return <OutlineManager />;
      default:
        return <BasicInfoManager />;
    }
  };

  return (
    <div className="story-objects-container">
      <div className="story-objects-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">홈</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">스토리 오브젝트</span>
        </div>
        <h1>스토리 오브젝트 관리</h1>
        <p>소설의 기본 정보, 등장인물, 배경 설정 등을 관리하세요</p>
      </div>

      <div className="story-objects-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="story-objects-content">
        {renderContent()}
      </div>
    </div>
  );
};

export default StoryObjects;