import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { projects, createProject, deleteProject, setCurrentProject } = useProjectStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

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
    if (confirm('프로젝트를 삭제하시겠습니까?')) {
      deleteProject(projectId);
    }
  };

  return (
    <div className="home-container">
      <div className="home-header">
        <h1>소설 생성기</h1>
        <p>AI와 함께 창의적인 소설을 써보세요</p>
      </div>

      <div className="actions">
        <button 
          className="create-button" 
          onClick={() => setShowCreateForm(true)}
        >
          새 프로젝트 만들기
        </button>
      </div>

      {showCreateForm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>새 프로젝트 만들기</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label htmlFor="projectName">프로젝트 이름</label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="프로젝트 이름을 입력하세요"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="projectDescription">설명 (선택사항)</label>
                <textarea
                  id="projectDescription"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="프로젝트에 대한 간단한 설명"
                  rows={3}
                />
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setShowCreateForm(false)}>
                  취소
                </button>
                <button type="submit">만들기</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="projects-section">
        <h2>내 프로젝트</h2>
        {projects.length === 0 ? (
          <div className="empty-state">
            <p>아직 프로젝트가 없습니다.</p>
            <p>새 프로젝트를 만들어 시작해보세요!</p>
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
                    생성일: {project.createdAt.toLocaleDateString()}
                  </p>
                </div>
                <button 
                  className="delete-button"
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  title="프로젝트 삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;