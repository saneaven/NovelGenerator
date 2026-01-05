import React, { useRef, useState, useEffect } from 'react';
import './StoryObjectPanel.css';
import '../../../components/ManagerCommon.css';
import BasicInfoManager from '../../../components/BasicInfoManager';
import NameDescriptionManager from '../../../components/NameDescriptionManager';
import { Clipboard, People, Organization, Map, Books, ChevronLeft, ChevronRight } from '../../../components/icons';
import type { StoryObjectTabType } from '../../../types/storyObject';
import { useStoryObjectTab } from '../hooks/useStoryObjectTab';

interface StoryObjectPanelProps {
  globalDisplayLanguage: string; // Actual language name (e.g., 'English', 'Korean')
}

const StoryObjectPanel: React.FC<StoryObjectPanelProps> = ({
  globalDisplayLanguage,
}) => {
  const { activeTab: activeStoryObjectTab, setActiveTab: setActiveStoryObjectTab } = useStoryObjectTab();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  const storyObjectTabs: { id: StoryObjectTabType; label: string; icon: React.ReactNode }[] = [
    { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="sm" /> },
    { id: 'characters', label: 'Characters', icon: <People size="sm" /> },
    { id: 'organizations', label: 'Organizations', icon: <Organization size="sm" /> },
    { id: 'locations', label: 'Locations', icon: <Map size="sm" /> },
    { id: 'lorebook', label: 'Lorebook', icon: <Books size="sm" /> },
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
      case 'characters':
        return (
          <NameDescriptionManager
            category="character"
            title="Characters"
            singularName="Character"
            pluralName="Characters"
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'organizations':
        return (
          <NameDescriptionManager
            category="organization"
            title="Organizations"
            singularName="Organization"
            pluralName="Organizations"
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'locations':
        return (
          <NameDescriptionManager
            category="location"
            title="Locations"
            singularName="Location"
            pluralName="Locations"
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'lorebook':
        return (
          <NameDescriptionManager
            category="lorebook"
            title="Lorebook"
            singularName="Entry"
            pluralName="Entries"
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      default:
        return <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />;
    }
  };

  return (
    <div className="story-object-panel">
      <div className="story-object-header">
        <h2><Clipboard size="2xl" /> Story Objects</h2>
      </div>

      <div className="story-object-tabs-container">
        <button
          className={`story-object-tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label="Scroll tabs left"
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
          aria-label="Scroll tabs right"
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