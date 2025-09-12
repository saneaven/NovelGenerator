import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import SettingsModal from '../components/SettingsModal';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { projects, createProject, deleteProject, setCurrentProject } = useProjectStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim()) {
      const newProject = createProject(projectName.trim(), projectDescription.trim());
      setCurrentProject(newProject.id);
      navigate(`/project/${newProject.id}`);
      setProjectName('');
      setProjectDescription('');
      setShowCreateForm(false);
    }
  };

  const handleOpenProject = (projectId: string) => {
    setCurrentProject(projectId);
    navigate(`/project/${projectId}`);
  };

  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      deleteProject(projectId);
    }
  };

  return (
    <div className="home-container">
      <div className="home-header">
        <div className="header-top">
          <div>
            <h1>Novel Generator</h1>
            <p>Write creative novels with AI</p>
          </div>
          <button 
            className="settings-btn"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

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
                    Created: {project.createdAt.toLocaleDateString()}
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