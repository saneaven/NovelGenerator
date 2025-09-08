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
        <h2>프로젝트를 찾을 수 없습니다</h2>
        <button onClick={() => navigate('/')}>홈으로 돌아가기</button>
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
          <Link to="/" className="breadcrumb-link">홈</Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">{currentProject.name}</span>
        </div>
        <h1>{currentProject.name}</h1>
        {currentProject.description && (
          <p className="project-description">{currentProject.description}</p>
        )}
        <div className="project-meta">
          <p>생성일: {currentProject.createdAt.toLocaleDateString()}</p>
          <p>마지막 수정: {currentProject.updatedAt.toLocaleDateString()}</p>
        </div>
      </div>

      <div className="menu-grid">
        <div className="menu-card" onClick={handleChatClick}>
          <div className="menu-icon">💬</div>
          <h3>AI 채팅</h3>
          <p>AI와 대화하며 소설 아이디어를 발전시켜보세요</p>
          <div className="menu-arrow">→</div>
        </div>

        <div className="menu-card" onClick={handleStoryObjectsClick}>
          <div className="menu-icon">📋</div>
          <h3>스토리 오브젝트</h3>
          <p>등장인물, 배경, 설정 등을 체계적으로 관리하세요</p>
          <div className="menu-arrow">→</div>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">📝</div>
          <h3>소설 편집기</h3>
          <p>구조화된 편집기로 소설을 작성하세요 (준비 중)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">🗺️</div>
          <h3>월드 빌딩</h3>
          <p>세계관과 설정을 시각적으로 관리하세요 (준비 중)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">📊</div>
          <h3>진행 상황</h3>
          <p>작업 진행도를 확인하세요 (준비 중)</p>
        </div>

        <div className="menu-card disabled">
          <div className="menu-icon">⚙️</div>
          <h3>설정</h3>
          <p>프로젝트 설정을 변경하세요 (준비 중)</p>
        </div>
      </div>
    </div>
  );
};

export default ProjectMenu;