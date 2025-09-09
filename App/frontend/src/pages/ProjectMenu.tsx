import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';

const ProjectMenu: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject, setCurrentProject } = useProjectStore();

  React.useEffect(() => {
    if (projectId) {
      setCurrentProject(projectId);
    }
  }, [projectId, setCurrentProject]);

  const currentProject = getCurrentProject();

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>Project Not Found</h2>
        <button onClick={() => navigate('/')}>Go back to Home</button>
      </div>
    );
  }

  const handleChatClick = () => {
    navigate(`/project/${projectId}/chat`);
  };

  const handleStoryObjectsClick = () => {
    navigate(`/project/${projectId}/story-objects`);
  };

  return (
    <div className="project-menu-container">
      <div className="project-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">Home</Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">{currentProject.name}</span>
        </div>
        <h1>{currentProject.name}</h1>
        {currentProject.description && (
          <p className="project-description">{currentProject.description}</p>
        )}
        <div className="project-meta">
          <p>Created: {currentProject.createdAt.toLocaleDateString()}</p>
          <p>Last updated: {currentProject.updatedAt.toLocaleDateString()}</p>
        </div>
      </div>

      <div className="menu-grid">
        <div className="menu-card" onClick={handleChatClick}>
          <div className="menu-icon">💬</div>
          <h3>AI Chat</h3>
          <p>Develop your novel ideas by chatting with the AI</p>
          <div className="menu-arrow">→</div>
        </div>

        <div className="menu-card" onClick={handleStoryObjectsClick}>
          <div className="menu-icon">📋</div>
          <h3>Story Objects</h3>
          <p>Systematically manage characters, backgrounds, settings, etc.</p>
          <div className="menu-arrow">→</div>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">📝</div>
          <h3>Novel Editor</h3>
          <p>Write your novel with a structured editor (Coming soon)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">🗺️</div>
          <h3>World Building</h3>
          <p>Visually manage your world and settings (Coming soon)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">📊</div>
          <h3>Progress</h3>
          <p>Check your work progress (Coming soon)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">⚙️</div>
          <h3>Settings</h3>
          <p>Change project settings (Coming soon)</p>
        </div>
      </div>
    </div>
  );
};

export default ProjectMenu;