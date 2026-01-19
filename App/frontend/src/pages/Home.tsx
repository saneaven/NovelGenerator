import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import './Home.css';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { getAssetUrl } from '../utils/assetUrl';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import { IconButton } from '../components/IconButton';
import { Settings, Logout, Close, Plus } from '../components/icons';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { projects, createProject, deleteProject, setCurrentProject, fetchProjects, isLoading, error } = useProjectStore();
  const { logout, user } = useAuthStore();
  const { settings } = useSettingsStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Fetch projects on mount and when returning to page
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Refetch when window gains focus (user returns to tab/window)
  useEffect(() => {
    const handleFocus = () => {
      fetchProjects();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchProjects]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim()) {
      try {
        const newProject = await createProject(projectName.trim(), projectDescription.trim(), settings.mainLanguage);
        setCurrentProject(newProject.id);
        navigate(`/project/${newProject.id}`);
        setProjectName('');
        setProjectDescription('');
        setShowCreateForm(false);
      } catch (err) {
        console.error('Failed to create project:', err);
      }
    }
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logout();
      navigate('/login');
    }
  };

  const handleOpenProject = (projectId: string) => {
    setCurrentProject(projectId);
    navigate(`/project/${projectId}`);
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      try {
        await deleteProject(projectId);
      } catch (err) {
        console.error('Failed to delete project:', err);
      }
    }
  };

  if (isLoading && projects.length === 0) {
    return (
      <div className="home-layout loading">
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
          <p>Loading your library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="home-layout">
      <header className="home-header">
        <div className="header-content">
          <div className="user-controls">
            <div className="icon-actions">
              <IconButton
                icon={<Settings size="lg" />}
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                size="md"
              />
              <IconButton
                icon={<Logout size="lg" />}
                onClick={handleLogout}
                title="Logout"
                size="md"
              />
            </div>
          </div>
          <div className="brand-area">
            <h1>Novel Buds</h1>
            {user && <span className="user-greeting">Hello, <b>{user.username}</b></span>}
          </div>
        </div>
      </header>

      <main className="home-main">
        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <div className="controls-bar">
          <h2 className="section-title">Library</h2>
          <button 
            className="btn-create-project" 
            onClick={() => setShowCreateForm(true)}
          >
            <Plus size="md" />
            <span>New Project</span>
          </button>
        </div>

        <div className="projects-grid">
          {projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-content">
                <h3>Your library is empty</h3>
                <p>Start your first novel journey today.</p>
                <button 
                  className="btn-text-action"
                  onClick={() => setShowCreateForm(true)}
                >
                  Create Project
                </button>
              </div>
            </div>
          ) : (
            projects.map((project) => (
              <article
                key={project.id}
                className="project-card"
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-card-image-wrapper">
                  {project.cover_asset ? (
                    <img src={getAssetUrl(project.cover_asset, 'original') || ''} alt={project.name} loading="lazy" />
                  ) : (
                    <div className="placeholder-cover" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                      <span className="project-initial">{project.name.charAt(0)}</span>
                    </div>
                  )}
                  <div className="project-card-overlay">
                    <IconButton
                      icon={<Close size="sm" />}
                      onClick={(e) => handleDeleteProject(e, project.id)}
                      title="Delete project"
                      size="sm"
                      variant="danger"
                      className="btn-delete-project"
                    />
                  </div>
                </div>
                
                <div className="project-card-content">
                  <h3 className="project-title">{project.name}</h3>
                  <div className="project-meta">
                    <span className="project-date">
                      {new Date(project.created_at).toLocaleDateString(undefined, { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </span>
                  </div>
                  {project.description && (
                    <p className="project-description">{project.description}</p>
                  )}
                </div>                  
              </article>
            ))
          )}
        </div>
      </main>

      {showCreateForm && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Create New Project</h2>
              <IconButton 
                icon={<Close size="md" />} 
                onClick={() => setShowCreateForm(false)} 
                variant="ghost"
                title="Close"
              />
            </div>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label htmlFor="projectName">Project Name</label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="The next bestseller..."
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="projectDescription">Description <span className="optional">(Optional)</span></label>
                <textarea
                  id="projectDescription"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="What is this story about?"
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">Create Project</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
};

export default Home;