import React from 'react';
import './StoryEntityPanel.css';
import '../../../components/ObjectManager/ManagerCommon.css';
import StoryEntityExplorer from '../../../components/StoryEntityExplorer/StoryEntityExplorer';

interface StoryEntityPanelProps {
  globalDisplayLanguage: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

const StoryEntityPanel: React.FC<StoryEntityPanelProps> = ({
  globalDisplayLanguage,
  selectedFolderId,
  onSelectFolder,
}) => {
  return (
    <div className="story-entity-panel">
      <div className="story-entity-content">
        <StoryEntityExplorer
          globalDisplayLanguage={globalDisplayLanguage}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      </div>
    </div>
  );
};

export default StoryEntityPanel;
