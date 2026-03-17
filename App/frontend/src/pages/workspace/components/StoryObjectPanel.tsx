import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './StoryObjectPanel.css';
import '../../../components/StoryObjectManager/ManagerCommon.css';
import BasicInfoManager from '../../../components/StoryObjectManager/BasicInfoManager';
import GuidelinesManager from '../../../components/StoryObjectManager/GuidelinesManager';
import StoryEntityExplorer from '../../../components/StoryEntityExplorer/StoryEntityExplorer';
import { Clipboard, Folder, ChevronLeft, ChevronRight, Document } from '../../../components/icons';
import type { StoryObjectTabType } from '../../../types/objectTypeConfig';
import { useStoryObjectTab } from '../hooks/useStoryObjectTab';

interface StoryObjectPanelProps {
  globalDisplayLanguage: string; // Actual language name (e.g., 'English', 'Korean')
}

const StoryObjectPanel: React.FC<StoryObjectPanelProps> = ({
  globalDisplayLanguage,
}) => {
  const { t } = useTranslation();
  const { activeTab: activeStoryObjectTab, setActiveTab: setActiveStoryObjectTab } = useStoryObjectTab();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  const storyObjectTabs: { id: StoryObjectTabType; label: string; icon: React.ReactNode }[] = [
    { id: 'basicInfo', label: t('storyObjectPanel.tabs.basicInfo'), icon: <Clipboard size="sm" /> },
    { id: 'guidelines', label: t('storyObjectPanel.tabs.guidelines'), icon: <Document size="sm" /> },
    { id: 'storyEntities', label: t('storyObjectPanel.tabs.storyEntities', 'Story Entities'), icon: <Folder size="sm" /> },
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
  }, [activeStoryObjectTab]);

  const renderStoryContent = () => {
    switch (activeStoryObjectTab) {
      case 'basicInfo':
        return <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />;
      case 'guidelines':
        return <GuidelinesManager globalDisplayLanguage={globalDisplayLanguage} />;
      case 'storyEntities':
        return <StoryEntityExplorer globalDisplayLanguage={globalDisplayLanguage} />;
      default:
        return <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />;
    }
  };

  return (
    <div className="story-object-panel">
      <div className="story-object-tabs-container">
        <button
          className={`story-object-tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label={t('storyObjectPanel.scrollTabsLeft')}
        >
          <ChevronLeft size="sm" />
        </button>

        <div
          className="story-object-tabs"
          ref={tabsRef}
          onScroll={checkScroll}
        >
          {storyObjectTabs.map((tab) => (
            <button
              key={tab.id}
              className={`story-object-tab-button ${activeStoryObjectTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveStoryObjectTab(tab.id)}
            >
              <span className="story-object-tab-icon">{tab.icon}</span>
              <span className="story-object-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          className={`story-object-tab-nav-button right ${showRightButton ? 'visible' : ''}`}
          onClick={() => scroll('right')}
          aria-label={t('storyObjectPanel.scrollTabsRight')}
        >
          <ChevronRight size="sm" />
        </button>
      </div>

      <div className="story-object-content">
          {renderStoryContent()}
      </div>
    </div>
  );
};

export default StoryObjectPanel;
