import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store/projectStore';
import './Home.css';
import { useAuthStore } from '../store/authStore';
import { useSettings } from '../store/settingsStore';
import { getAssetUrl } from '../utils/assetUrl';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import { IconButton } from '../components/IconButton';
import { Settings, Logout, Close, Plus, Upload } from '../components/icons';
import { Loading } from '../components/common/Loading';

const Home: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, createProject, importProject, deleteProject, setCurrentProject, fetchProjects, isLoading, error } =
    useProjectStore();
  const { logout, user } = useAuthStore();
  const settings = useSettings();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
    if (confirm(t('home.confirmLogout'))) {
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
    if (confirm(t('home.confirmDelete'))) {
      try {
        await deleteProject(projectId);
      } catch (err) {
        console.error('Failed to delete project:', err);
      }
    }
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.name && !file.name.toLowerCase().endsWith('.nbproj')) {
      alert(t('home.selectNbprojFile'));
      return;
    }

    setIsImporting(true);
    try {
      const imported = await importProject(file);
      setCurrentProject(imported.id);
      navigate(`/project/${imported.id}`);
    } catch (err) {
      console.error('Failed to import project:', err);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="home-layout">
      <header className="home-header">
        <div className="header-content">
          <div className="user-controls">
            <div className="icon-actions">
              <IconButton
                icon={<Settings size="lg" />}
                onClick={() => setIsSettingsModalOpen(true)}
                title={t('common.settings')}
                size="lg"
              />
              <IconButton
                icon={<Logout size="lg" />}
                onClick={handleLogout}
                title={t('common.logout')}
                size="lg"
              />
            </div>
          </div>
          <div className="brand-area">
            <h1>{t('landing.title')}</h1>
            {user && <span className="user-greeting">{t('home.hello', { username: user.username })}</span>}
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
          <h2 className="section-title">{t('home.library')}</h2>
          <div className="controls-actions">
            <input
              ref={importInputRef}
              type="file"
              accept=".nbproj"
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleImportFileSelected(e);
              }}
            />
            <button
              className="btn-import-project"
              onClick={handleImportClick}
              disabled={isImporting || isLoading}
              title={t('home.importProject')}
            >
              <Upload size="md" />
              <span>{isImporting ? t('home.importing') : t('home.importProject')}</span>
            </button>
            <button className="btn-create-project" onClick={() => setShowCreateForm(true)} disabled={isLoading}>
              <Plus size="md" />
              <span>{t('home.newProject')}</span>
            </button>
          </div>
        </div>

        <div className="projects-grid">
          {isLoading && projects.length === 0 ? (
            <div className="projects-grid-loading">
              <Loading text={t('home.loadingLibrary')} />
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-content">
                <h3>{t('home.emptyLibrary')}</h3>
                <p>{t('home.startFirstNovel')}</p>
                <button
                  className="btn-text-action"
                  onClick={() => setShowCreateForm(true)}
                >
                  {t('home.createProject')}
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
                    <img src={getAssetUrl(project.cover_asset) || ''} alt={project.name} loading="lazy" />
                  ) : (
                    <div className="placeholder-cover" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                      <span className="project-initial">{project.name.charAt(0)}</span>
                    </div>
                  )}
                  <div className="project-card-overlay">
                    <IconButton
                      icon={<Close size="sm" />}
                      onClick={(e) => { void handleDeleteProject(e, project.id); }}
                      title={t('home.deleteProject')}
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
              <h2>{t('home.createNewProject')}</h2>
              <IconButton
                icon={<Close size="md" />}
                onClick={() => setShowCreateForm(false)}
                variant="ghost"
                title={t('common.close')}
              />
            </div>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label htmlFor="projectName">{t('home.projectName')}</label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={t('home.projectNamePlaceholder')}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="projectDescription">{t('home.description')} <span className="optional">({t('common.optional')})</span></label>
                <textarea
                  id="projectDescription"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder={t('home.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateForm(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-submit">{t('home.createProject')}</button>
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
