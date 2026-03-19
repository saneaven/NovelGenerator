import React, { useRef, useState, useEffect } from 'react';
import '../../../components/ObjectManager/ManagerCommon.css';
import BasicInfoManager from '../../../components/ObjectManager/BasicInfoManager';
import GuidelinesManager from '../../../components/ObjectManager/GuidelinesManager';
import { Clipboard, Document, ChevronLeft, ChevronRight } from '../../../components/icons';
import './ProjectHomePanel.css';

export type ProjectHomeTab = 'basicInfo' | 'guidelines';

interface ProjectHomePanelProps {
  globalDisplayLanguage: string;
  activeTab: ProjectHomeTab;
  onTabChange: (tab: ProjectHomeTab) => void;
}

const TABS: { id: ProjectHomeTab; label: string; icon: React.ReactNode }[] = [
  { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="sm" /> },
  { id: 'guidelines', label: 'Guidelines', icon: <Document size="sm" /> },
];

const ProjectHomePanel: React.FC<ProjectHomePanelProps> = ({
  globalDisplayLanguage,
  activeTab,
  onTabChange,
}) => {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  const checkScroll = () => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
      setShowLeftButton(scrollLeft > 0);
      setShowRightButton(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = 200;
      const newScrollLeft = direction === 'left'
        ? tabsRef.current.scrollLeft - scrollAmount
        : tabsRef.current.scrollLeft + scrollAmount;
      tabsRef.current.scrollTo({ left: newScrollLeft, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    checkScroll();
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(checkScroll);
    if (tabsRef.current) {
      resizeObserver.observe(tabsRef.current);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    checkScroll();
  }, [activeTab]);

  return (
    <div className="project-home-panel">
      <div className="project-home-tabs-container">
        <button
          className={`project-home-tab-nav-button left ${showLeftButton ? 'visible' : ''}`}
          onClick={() => scroll('left')}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft size="sm" />
        </button>

        <div
          className="project-home-tabs"
          ref={tabsRef}
          onScroll={checkScroll}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`project-home-tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="project-home-tab-icon">{tab.icon}</span>
              <span className="project-home-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          className={`project-home-tab-nav-button right ${showRightButton ? 'visible' : ''}`}
          onClick={() => scroll('right')}
          aria-label="Scroll tabs right"
        >
          <ChevronRight size="sm" />
        </button>
      </div>

      <div className="project-home-content">
        {activeTab === 'basicInfo' && (
          <BasicInfoManager globalDisplayLanguage={globalDisplayLanguage} />
        )}
        {activeTab === 'guidelines' && (
          <GuidelinesManager globalDisplayLanguage={globalDisplayLanguage} />
        )}
      </div>
    </div>
  );
};

export default ProjectHomePanel;
