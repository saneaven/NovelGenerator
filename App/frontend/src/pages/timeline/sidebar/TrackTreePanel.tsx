import React from 'react';
import TrackTreeContent, { type TrackTreeContentProps } from './TrackTreeContent';

/** Desktop docked pane host (hidden ≤768px via CSS). */
const TrackTreePanel: React.FC<TrackTreeContentProps> = (props) => (
  <aside className="tl-tree-panel">
    <TrackTreeContent {...props} />
  </aside>
);

export default TrackTreePanel;
