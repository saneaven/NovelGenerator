import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './StoryEntityPanel.css';
import '../../../components/ObjectManager/ManagerCommon.css';
import BasicInfoManager from '../../../components/ObjectManager/BasicInfoManager';
import GuidelinesManager from '../../../components/ObjectManager/GuidelinesManager';
import StoryEntityExplorer from '../../../components/StoryEntityExplorer/StoryEntityExplorer';
import { Clipboard, Folder, ChevronLeft, ChevronRight, Document } from '../../../components/icons';
import type { StoryEntityTabType } from '../../../types/objectTypeConfig';
import { useStoryEntityTab } from '../hooks/useStoryEntityTab';

interface StoryEntityPanelProps {
  globalDisplayLanguage: string; // Actual language name (e.g., 'English', 'Korean')
}

const StoryEntityPanel: React.FC<StoryEntityPanelProps> = ({
  globalDisplayLanguage,
}) => {
  const { t } = useTranslation();
  const { activeTab: activeStoryEntityTab, setActiveTab: setActiveStoryEntityTab } = useStoryEntityTab();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  const storyEntityTabs: { id: StoryEntityTabType; label: string; icon: React.ReactNode }[] = [
    { id: 'basicInfo', label: t('storyEntityPanel.tabs.basicInfo'), icon: <Clipboard size="sm" /> },
    { id: 'guidelines', label: t('storyEntityPanel.tabs.guidelines'), icon: <Document size="sm" /> },
    { id: 'storyEntities', label: t('storyEntityPanel.tabs.storyEntities', 'Story Entities'), icon: <Folder size="sm" /> },
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
  }, [activeStoryEntityTab]);

  const renderStoryContent = () => {
    switch (activeStoryEntityTab) {
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
    <div className="story-entity-panel">
      <div className="story-entity-tabs-container">
        <button
          className={`story-entity-tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label={t('storyEntityPanel.scrollTabsLeft')}
        >
          <ChevronLeft size="sm" />
        </button>

        <div
          className="story-entity-tabs"
          ref={tabsRef}
          onScroll={checkScroll}
        >
          {storyEntityTabs.map((tab) => (
            <button
              key={tab.id}
              className={`story-entity-tab-button ${activeStoryEntityTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveStoryEntityTab(tab.id)}
            >
              <span className="story-entity-tab-icon">{tab.icon}</span>
              <span className="story-entity-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          className={`story-entity-tab-nav-button right ${showRightButton ? 'visible' : ''}`}
          onClick={() => scroll('right')}
          aria-label={t('storyEntityPanel.scrollTabsRight')}
        >
          <ChevronRight size="sm" />
        </button>
      </div>

      <div className="story-entity-content">
          {renderStoryContent()}
      </div>
    </div>
  );
};

export default StoryEntityPanel;
