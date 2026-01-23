import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './StoryObjectPanel.css';
import '../../../components/StoryObjectManager/ManagerCommon.css';
import BasicInfoManager from '../../../components/StoryObjectManager/BasicInfoManager';
import GuidelinesManager from '../../../components/StoryObjectManager/GuidelinesManager';
import NameDescriptionManager from '../../../components/StoryObjectManager/NameDescriptionManager';
import { Clipboard, People, Organization, Map, Books, ChevronLeft, ChevronRight, Document } from '../../../components/icons';
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
    { id: 'characters', label: t('storyObjectPanel.tabs.characters'), icon: <People size="sm" /> },
    { id: 'organizations', label: t('storyObjectPanel.tabs.organizations'), icon: <Organization size="sm" /> },
    { id: 'locations', label: t('storyObjectPanel.tabs.locations'), icon: <Map size="sm" /> },
    { id: 'lorebook', label: t('storyObjectPanel.tabs.lorebook'), icon: <Books size="sm" /> },
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
      case 'characters':
        return (
          <NameDescriptionManager
            category="character"
            title={t('storyObjectPanel.categories.character.title')}
            singularName={t('storyObjectPanel.categories.character.singular')}
            pluralName={t('storyObjectPanel.categories.character.plural')}
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'organizations':
        return (
          <NameDescriptionManager
            category="organization"
            title={t('storyObjectPanel.categories.organization.title')}
            singularName={t('storyObjectPanel.categories.organization.singular')}
            pluralName={t('storyObjectPanel.categories.organization.plural')}
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'locations':
        return (
          <NameDescriptionManager
            category="location"
            title={t('storyObjectPanel.categories.location.title')}
            singularName={t('storyObjectPanel.categories.location.singular')}
            pluralName={t('storyObjectPanel.categories.location.plural')}
            globalDisplayLanguage={globalDisplayLanguage}
          />
        );
      case 'lorebook':
        return (
          <NameDescriptionManager
            category="lorebook"
            title={t('storyObjectPanel.categories.lorebook.title')}
            singularName={t('storyObjectPanel.categories.lorebook.singular')}
            pluralName={t('storyObjectPanel.categories.lorebook.plural')}
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
        <h2><Clipboard size="2xl" /> {t('storyObjectPanel.title')}</h2>
      </div>

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