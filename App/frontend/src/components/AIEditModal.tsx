import React, { useState, useRef, useEffect } from 'react';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { streamCopilot } from '../llm_request/copilot';
import type { ConversationBlock } from '../llm_request/types';
import type { StoryObjectCategory } from '../types/storyObject';

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: StoryObjectCategory;
  projectId: string;
  targetId?: string; // null for category-wide editing
  onResult: (result: any) => void;
}

interface ContextOptions {
  basicInfo: boolean;
  characters: boolean;
  organizations: boolean;
  locations: boolean;
  lorebook: boolean;
  outline: boolean;
}

const AIEditModal: React.FC<AIEditModalProps> = ({
  isOpen,
  onClose,
  category,
  projectId,
  targetId,
  onResult,
}) => {
  const [userRequest, setUserRequest] = useState('');
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    basicInfo: true,
    characters: true,
    organizations: true,
    locations: true,
    lorebook: true,
    outline: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const storyObjectStore = useStoryObjectStore();
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setStreamContent('');
      setError(null);
      setIsProcessing(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    }
  }, [isOpen]);

  const getContextData = () => {
    const storyObjects = storyObjectStore.getStoryObjects(projectId);
    const context: Record<string, any> = {};

    if (contextOptions.basicInfo && storyObjects.basicInfo) {
      context.basicInfo = {
        title: storyObjects.basicInfo.title,
        logline: storyObjects.basicInfo.logline,
        genre: storyObjects.basicInfo.genre,
      };
    }

    if (contextOptions.characters && storyObjects.characters.length > 0) {
      context.characters = storyObjects.characters.map(char => ({
        id: char.id,
        name: char.name,
        description: char.description,
      }));
    }

    if (contextOptions.organizations && storyObjects.organizations.length > 0) {
      context.organizations = storyObjects.organizations.map(org => ({
        id: org.id,
        name: org.name,
        description: org.description,
      }));
    }

    if (contextOptions.locations && storyObjects.locations.length > 0) {
      context.locations = storyObjects.locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        description: loc.description,
      }));
    }

    if (contextOptions.lorebook && storyObjects.lorebook.length > 0) {
      context.lorebook = storyObjects.lorebook.map(entry => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
      }));
    }

    if (contextOptions.outline && storyObjects.outline) {
      context.outline = {
        acts: storyObjects.outline.acts.map(act => ({
          id: act.id,
          name: act.name,
          description: act.description,
          chapters: act.chapters.map(chapter => ({
            id: chapter.id,
            name: chapter.name,
            description: chapter.description,
          })),
        })),
      };
    }

    return context;
  };

  const getCategoryDisplayName = (cat: StoryObjectCategory): string => {
    const names = {
      basicInfo: '기본 정보',
      character: '등장인물',
      organization: '조직/단체',
      location: '장소',
      lorebook: '로어북',
      outline: '아웃라인',
    };
    return names[cat] || cat;
  };


  const getCurrentData = () => {
    const storyObjects = storyObjectStore.getStoryObjects(projectId);
    
    if (targetId) {
      // Editing specific item
      switch (category) {
        case 'character':
          return storyObjects.characters.find(c => c.id === targetId);
        case 'organization':
          return storyObjects.organizations.find(o => o.id === targetId);
        case 'location':
          return storyObjects.locations.find(l => l.id === targetId);
        case 'lorebook':
          return storyObjects.lorebook.find(e => e.id === targetId);
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        default:
          return null;
      }
    } else {
      // Editing entire category
      switch (category) {
        case 'character':
          return storyObjects.characters;
        case 'organization':
          return storyObjects.organizations;
        case 'location':
          return storyObjects.locations;
        case 'lorebook':
          return storyObjects.lorebook;
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        default:
          return null;
      }
    }
  };

  const getJSONSchema = (): string => {
    if (targetId) {
      // Schema for individual items
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          return JSON.stringify({
            id: "string (기존 ID 유지)",
            name: "string",
            description: "string"
          }, null, 2);
        case 'basicInfo':
          return JSON.stringify({
            title: "string",
            logline: "string",
            genre: "string"
          }, null, 2);
        case 'outline':
          return JSON.stringify({
            acts: [{
              id: "string (기존 ID 유지)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string (기존 ID 유지)",
                name: "string",
                description: "string"
              }]
            }]
          }, null, 2);
        default:
          return "{}";
      }
    } else {
      // Schema for entire category
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          return JSON.stringify([{
            id: "string | null (수정시 기존 ID, 추가시 null)",
            name: "string",
            description: "string"
          }], null, 2);
        case 'basicInfo':
          return JSON.stringify({
            title: "string",
            logline: "string",
            genre: "string"
          }, null, 2);
        case 'outline':
          return JSON.stringify({
            acts: [{
              id: "string | null (수정시 기존 ID, 추가시 null)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string | null (수정시 기존 ID, 추가시 null)",
                name: "string",
                description: "string"
              }]
            }]
          }, null, 2);
        default:
          return "{}";
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    setIsProcessing(true);
    setStreamContent('');
    setError(null);

    try {
      abortControllerRef.current = new AbortController();
      
      const context = getContextData();
      const currentData = getCurrentData();
      const jsonSchema = getJSONSchema();
      
      const editType = targetId ? '특정 항목' : '전체 카테고리';
      const categoryName = getCategoryDisplayName(category);

      const systemPrompt = `당신은 소설 창작을 도와주는 AI 어시스턴트입니다. 사용자가 스토리 오브젝트의 ${editType}(${categoryName})를 수정하고자 합니다.
다음 컨텍스트를 참고하여 사용자의 요청에 따라 JSON 형식으로 수정된 데이터를 반환해주세요.

<Context>
${Object.keys(context).map(key => `# ${key.charAt(0).toUpperCase() + key.slice(1)}\n${JSON.stringify(context[key], null, 2)}`).join('\n\n')}
</Context>

현재 데이터:
${JSON.stringify(currentData, null, 2)}

요청사항에 따라 위 데이터를 수정하여 다음 JSON 스키마에 맞춰 반환해주세요:
${jsonSchema}

중요 규칙:
1. ID 처리 방법:
   - 기존 항목을 수정하는 경우: 현재 데이터의 ID를 그대로 유지
   - 새로운 항목을 추가하는 경우: id를 null로 설정`;

      const messages: ConversationBlock[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userRequest },
      ];

      let fullResponse = '';
      
      for await (const chunk of streamCopilot(messages, {
        signal: abortControllerRef.current.signal,
        temperature: 0.3,
      })) {
        fullResponse += chunk;
        setStreamContent(fullResponse);
      }

      // Parse and validate JSON response
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = fullResponse.trim();
        console.log('원본 AI 응답:', fullResponse);
        
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();
          console.log('코드블록에서 추출한 JSON:', jsonText);
        } else {
          console.log('코드블록 없음, 원본 사용:', jsonText);
        }
        
        const parsedResult = JSON.parse(jsonText);
        console.log('파싱된 JSON:', parsedResult);
        
        // Save version before applying result
        if (targetId) {
          // For individual item edits, save as a new version
          const versionId = storyObjectStore.addVersion(
            projectId,
            category,
            targetId,
            userRequest,
            parsedResult
          );
          console.log('버전 저장됨:', versionId);
        }
        
        onResult(parsedResult);
        onClose();
      } catch (parseError) {
        console.error('JSON 파싱 오류:', parseError);
        setError(`AI 응답을 JSON으로 파싱할 수 없습니다: ${parseError}`);
      }

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return; // User cancelled, don't show error
        }
        setError(err.message);
      } else {
        setError('알 수 없는 오류가 발생했습니다.');
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    onClose();
  };

  const toggleContextOption = (option: keyof ContextOptions) => {
    setContextOptions(prev => ({
      ...prev,
      [option]: !prev[option],
    }));
  };

  if (!isOpen) return null;

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? '항목' : '전체';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {categoryDisplayName} {editTypeText} 편집</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">수정 요청사항</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`${categoryDisplayName} ${editTypeText}에 대한 수정 요청사항을 입력하세요.
예: "주인공의 성격을 더 적극적으로 바꿔주세요", "모든 장소의 분위기를 더 어둡게 만들어주세요"`}
              rows={4}
              required
              disabled={isProcessing}
            />
          </div>

          <div className="form-group context-options">
            <label>컨텍스트 포함 옵션</label>
            <div className="checkbox-group">
              {Object.entries(contextOptions).map(([key, checked]) => (
                <label key={key} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleContextOption(key as keyof ContextOptions)}
                    disabled={isProcessing}
                  />
                  <span className="checkbox-text">
                    {getCategoryDisplayName(key as StoryObjectCategory)}
                  </span>
                </label>
              ))}
            </div>
            <p className="context-help">
              AI가 참고할 컨텍스트를 선택하세요. 더 많은 컨텍스트를 제공할수록 일관성 있는 결과를 얻을 수 있습니다.
            </p>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {streamContent && (
            <div className="ai-response">
              <h3>AI 응답:</h3>
              <pre className="response-content">{streamContent}</pre>
            </div>
          )}

          <div className="form-actions">
            <button 
              type="button" 
              onClick={handleCancel} 
              className="cancel-button"
              disabled={isProcessing}
            >
              취소
            </button>
            <button 
              type="submit" 
              className="submit-button"
              disabled={!userRequest.trim() || isProcessing}
            >
              {isProcessing ? 'AI 처리 중...' : 'AI 편집 요청'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIEditModal;