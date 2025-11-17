import React, { useRef, useState, useEffect, useMemo } from 'react';
import BasicInfoManager from '../../../components/BasicInfoManager';
import NameDescriptionManager from '../../../components/NameDescriptionManager';
import OutlineManager from '../../../components/OutlineManager';
import BatchTranslationModal from '../../../components/BatchTranslationModal';
import { useProjectStore } from '../../../store/projectStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

interface StoryPanelProps {
  activeStoryTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const StoryPanel: React.FC<StoryPanelProps> = ({ activeStoryTab, onTabChange }) => {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);
  const [showBatchTranslateModal, setShowBatchTranslateModal] = useState(false);

  const { currentProjectId } = useProjectStore();
  const store = useUnifiedObjectStore();
  const settings = useSettingsStore((state) => state.settings);

  const storyTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'basicInfo', label: 'Basic Info', icon: '📋' },
    { id: 'characters', label: 'Characters', icon: '👥' },
    { id: 'organizations', label: 'Organizations', icon: '🏛️' },
    { id: 'locations', label: 'Locations', icon: '🗺️' },
    { id: 'lorebook', label: 'Lorebook', icon: '📚' },
    { id: 'outline', label: 'Outline', icon: '📝' },
  ];

  // Check scroll position to show/hide navigation buttons
  const checkScroll = () => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
      setShowLeftButton(scrollLeft > 0);
      setShowRightButton(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  // Scroll tabs by a fixed amount
  const scroll = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = 200;
      const newScrollLeft = direction === 'left'
        ? tabsRef.current.scrollLeft - scrollAmount
        : tabsRef.current.scrollLeft + scrollAmount;

      tabsRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      });
    }
  };

  // Check scroll on mount and when window resizes
  useEffect(() => {
    checkScroll();
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);

    // Use ResizeObserver to detect when tabs content changes
    const resizeObserver = new ResizeObserver(checkScroll);
    if (tabsRef.current) {
      resizeObserver.observe(tabsRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  // Check scroll when active tab changes
  useEffect(() => {
    checkScroll();
  }, [activeStoryTab]);

  // Calculate count of objects needing translation
  const objectsNeedingTranslation = useMemo(() => {
    if (!settings.secondaryLanguage || !currentProjectId) return 0;

    const allObjects = Object.values(store.objects);
    let count = 0;

    allObjects.forEach((obj: any) => {
      if (obj.metadata?.project_id !== currentProjectId) return;
      if (obj.languages?.available.includes(settings.secondaryLanguage)) return;
      if (obj.languages?.active !== settings.primaryLanguage) return;

      count++;
    });

    return count;
  }, [store.objects, currentProjectId, settings.primaryLanguage, settings.secondaryLanguage]);

  const handleBatchTranslateComplete = () => {
    // Refresh objects after batch translation
    if (currentProjectId) {
      store.listObjects('basic_info', currentProjectId);
      store.listObjects('character', currentProjectId);
      store.listObjects('organization', currentProjectId);
      store.listObjects('location', currentProjectId);
      store.listObjects('lorebook', currentProjectId);
      store.listObjects('act', currentProjectId);
      store.listObjects('chapter', currentProjectId);
    }
  };

  const renderStoryContent = () => {
    switch (activeStoryTab) {
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
    <div className="story-panel">
      <div className="story-header">
        <h2>📋 Story Objects</h2>
        <div className="story-header-controls">
          {settings.secondaryLanguage && objectsNeedingTranslation > 0 && (
            <button
              onClick={() => setShowBatchTranslateModal(true)}
              className="batch-translate-btn"
              title={`Translate ${objectsNeedingTranslation} objects to ${settings.secondaryLanguage}`}
            >
              🌐 Translate All ({objectsNeedingTranslation})
            </button>
          )}
        </div>
      </div>

      <div className="story-tabs-container">
        <button
          className={`tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label="Scroll tabs left"
        >
          ◀
        </button>

        <div
          className="story-tabs"
          ref={tabsRef}
          onScroll={checkScroll}
        >
          {storyTabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeStoryTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          className={`tab-nav-button right ${showRightButton ? 'visible' : ''}`}
          onClick={() => scroll('right')}
          aria-label="Scroll tabs right"
        >
          ▶
        </button>
      </div>

      <div className="story-content">
        {renderStoryContent()}
      </div>

      <BatchTranslationModal
        isOpen={showBatchTranslateModal}
        onClose={() => setShowBatchTranslateModal(false)}
        projectId={currentProjectId || ''}
        onComplete={handleBatchTranslateComplete}
      />
    </div>
  );
};

export default StoryPanel;