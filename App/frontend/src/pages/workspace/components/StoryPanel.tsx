import React, { useRef, useState, useEffect } from 'react';
import BasicInfoManager from '../../../components/BasicInfoManager';
import NameDescriptionManager from '../../../components/NameDescriptionManager';
import OutlineManager from '../../../components/OutlineManager';
import { Clipboard, People, Organization, Map, Books, Document, ChevronLeft, ChevronRight } from '../../../components/icons';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

interface StoryPanelProps {
  activeStoryTab: TabType;
  onTabChange: (tab: TabType) => void;
  globalDisplayLanguage: string; // Actual language name (e.g., 'English', 'Korean')
}

const StoryPanel: React.FC<StoryPanelProps> = ({
  activeStoryTab,
  onTabChange,
  globalDisplayLanguage,
}) => {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  const storyTabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="sm" /> },
    { id: 'characters', label: 'Characters', icon: <People size="sm" /> },
    { id: 'organizations', label: 'Organizations', icon: <Organization size="sm" /> },
    { id: 'locations', label: 'Locations', icon: <Map size="sm" /> },
    { id: 'lorebook', label: 'Lorebook', icon: <Books size="sm" /> },
    { id: 'outline', label: 'Outline', icon: <Document size="sm" /> },
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

  const renderStoryContent = () => {
    switch (activeStoryTab) {
      case 'basicInfo':
        return <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />;
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
            placeholder={{
              name: 'Enter organization name',
              description: 'Describe the organization\'s purpose, structure, role, etc.'
            }}
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
            placeholder={{
              name: 'Enter location name',
              description: 'Describe the location\'s features, atmosphere, importance, etc.'
            }}
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
            placeholder={{
              name: 'Enter term or concept name',
              description: 'Write a detailed description of this term or concept'
            }}
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'outline':
        return <OutlineManager globalDisplayLanguage={globalDisplayLanguage} />;
      default:
        return <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />;
    }
  };

  return (
    <div className="story-panel">
      <div className="story-header">
        <h2><Clipboard size="2xl" /> Story Objects</h2>
      </div>

      <div className="story-tabs-container">
        <button
          className={`tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft size="sm" />
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
          <ChevronRight size="sm" />
        </button>
      </div>

      <div className="story-content">
          {renderStoryContent()}
      </div>
    </div>
  );
};

export default StoryPanel;