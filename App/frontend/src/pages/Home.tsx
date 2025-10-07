import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import SettingsModal from '../components/SettingsModal';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { projects, createProject, deleteProject, setCurrentProject, fetchProjects, isLoading, error } = useProjectStore();
  const { logout, user } = useAuthStore();
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
        const newProject = await createProject(projectName.trim(), projectDescription.trim());
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

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
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
      <div className="home-container">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
          <p>Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="home-container">
      <div className="home-header">
        <div className="header-top">
          <div>
            <h1>Novel Generator</h1>
            <p>Write creative novels with AI</p>
            {user && <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>Welcome, {user.username}!</p>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="settings-btn"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Settings"
            >
              ⚙️
            </button>
            <button
              className="settings-btn"
              onClick={handleLogout}
              title="Logout"
            >
              🚪
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          color: '#fca5a5',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      )}

      <div className="actions">
        <button 
          className="create-button" 
          onClick={() => setShowCreateForm(true)}
        >
          Create New Project
        </button>
      </div>

      {showCreateForm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Create New Project</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label htmlFor="projectName">Project Name</label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="projectDescription">Description (Optional)</label>
                <textarea
                  id="projectDescription"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="A brief description of the project"
                  rows={3}
                />
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="projects-section">
        <h2>My Projects</h2>
        {projects.length === 0 ? (
          <div className="empty-state">
            <p>No projects yet.</p>
            <p>Create a new project to get started!</p>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((project) => (
              <div 
                key={project.id} 
                className="project-card"
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-info">
                  <h3>{project.name}</h3>
                  {project.description && (
                    <p className="project-description">{project.description}</p>
                  )}
                  <p className="project-date">
                    Created: {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button 
                  className="delete-button"
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  title="Delete project"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
};

export default Home;