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
        <h2>Project Not Found</h2>
        <Link to="/">Go back to Home</Link>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'basicInfo', label: 'Basic Info', icon: '📋' },
    { id: 'characters', label: 'Characters', icon: '👥' },
    { id: 'organizations', label: 'Organizations', icon: '🏛️' },
    { id: 'locations', label: 'Locations', icon: '🗺️' },
    { id: 'lorebook', label: 'Lorebook', icon: '📚' },
    { id: 'outline', label: 'Outline', icon: '📝' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'basicInfo':
        return <BasicInfoManager />;
      case 'characters':
        return (
          <NameDescriptionManager
            category="character"
            title="Characters"
            singularName="Character"
            pluralName="Characters"
            placeholder={{
              name: 'Enter character name',
              description: 'Describe the character\'s appearance, personality, background, etc.'
            }}
          />
        );
      case 'organizations':
        return (
          <NameDescriptionManager
            category="organization"
            title="Organizations"
            singularName="Organization"
            pluralName="Organizations"
            placeholder={{
              name: 'Enter organization name',
              description: 'Describe the organization\'s purpose, structure, role, etc.'
            }}
          />
        );
      case 'locations':
        return (
          <NameDescriptionManager
            category="location"
            title="Locations"
            singularName="Location"
            pluralName="Locations"
            placeholder={{
              name: 'Enter location name',
              description: 'Describe the location\'s features, atmosphere, importance, etc.'
            }}
          />
        );
      case 'lorebook':
        return (
          <NameDescriptionManager
            category="lorebook"
            title="Lorebook"
            singularName="Entry"
            pluralName="Entries"
            placeholder={{
              name: 'Enter term or concept name',
              description: 'Write a detailed description of this term or concept'
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
          <Link to="/" className="breadcrumb-link">Home</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">Story Objects</span>
        </div>
        <h1>Manage Story Objects</h1>
        <p>Manage the basic information, characters, background settings, etc. of your novel</p>
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