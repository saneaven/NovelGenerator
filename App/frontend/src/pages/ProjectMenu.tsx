import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { Building, Document, ArrowRight, ArrowLeft } from '../components/icons';

const ProjectMenu: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject, setCurrentProject, fetchProjects, projects, isLoading } = useProjectStore();

  React.useEffect(() => {
    if (projectId) {
      setCurrentProject(projectId);
      // Fetch projects if not already loaded
      if (projects.length === 0) {
        fetchProjects();
      }
    }
  }, [projectId, setCurrentProject, fetchProjects, projects.length]);

  const currentProject = getCurrentProject();

  // Show loading state while fetching
  if (isLoading && !currentProject) {
    return (
      <div className="error-container">
        <p>Loading project...</p>
      </div>
    );
  }

  // Show error if project not found after loading
  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>Project Not Found</h2>
        <button onClick={() => navigate('/')}>Go back to Home</button>
      </div>
    );
  }

  const handleWorkspaceClick = () => {
    navigate(`/project/${projectId}/workspace`);
  };

  const handleNovelEditorClick = () => {
    navigate(`/project/${projectId}/novel-editor`);
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
          <p>Created: {new Date(currentProject.created_at).toLocaleDateString()}</p>
          <p>Last updated: {new Date(currentProject.updated_at).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="menu-grid">
        <div className="menu-card" onClick={handleWorkspaceClick}>
          <div className="menu-icon"><Building size={32} /></div>
          <h3>Workspace</h3>
          <p>Unified workspace with AI chat and story editing</p>
          <div className="menu-arrow"><ArrowRight size={16} /></div>
        </div>

        <div className="menu-card" onClick={handleNovelEditorClick}>
          <div className="menu-icon"><Document size={32} /></div>
          <h3>Novel Editor</h3>
          <p>Write your novel with a structured editor</p>
          <div className="menu-arrow"><ArrowRight size={16} /></div>
        </div>

      </div>

      <button className="back-home-btn mobile-only" onClick={() => navigate('/')}>
        <ArrowLeft size={14} /> Back to Home
      </button>
    </div>
  );
};

export default ProjectMenu;