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
      basicInfo: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
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
            id: "string (keep existing ID)",
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
              id: "string (keep existing ID)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string (keep existing ID)",
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
            id: "string | null (existing ID for modification, null for addition)",
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
              id: "string | null (existing ID for modification, null for addition)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string | null (existing ID for modification, null for addition)",
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
      
      const editType = targetId ? 'specific item' : 'entire category';
      const categoryName = getCategoryDisplayName(category);

      const systemPrompt = `You are an AI assistant that helps with novel writing. The user wants to modify the ${editType} (${categoryName}) of a story object.
Please refer to the following context and return the modified data in JSON format according to the user's request.

<Context>
${Object.keys(context).map(key => `# ${key.charAt(0).toUpperCase() + key.slice(1)}\n${JSON.stringify(context[key], null, 2)}`).join('\n\n')}
</Context>

Current data:
${JSON.stringify(currentData, null, 2)}

Please modify the above data according to the request and return it in the following JSON schema:
${jsonSchema}

Important rules:
1. ID handling:
   - When modifying an existing item: Keep the current data's ID.
   - When adding a new item: Set the id to null.`;

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
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();        } else {        }
        
        const parsedResult = JSON.parse(jsonText);        
        // Save version before applying result
        if (targetId) {
          // For individual item edits, save as a new version
          const versionId = storyObjectStore.addVersion(
            projectId,
            category,
            targetId,
            userRequest,
            parsedResult
          );        }
        
        onResult(parsedResult);
        onClose();
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        setError(`Could not parse AI response as JSON: ${parseError}`);
      }

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return; // User cancelled, don't show error
        }
        setError(err.message);
      } else {
        setError('An unknown error occurred.');
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
  const editTypeText = targetId ? 'Item' : 'All';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {categoryDisplayName} {editTypeText} Edit</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">Edit Request</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`Enter your edit request for the ${categoryDisplayName} ${editTypeText}.
e.g., "Make the main character's personality more proactive", "Make the atmosphere of all locations darker"`}
              rows={4}
              required
              disabled={isProcessing}
            />
          </div>

          <div className="form-group context-options">
            <label>Context Inclusion Options</label>
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
              Select the context for the AI to refer to. Providing more context will lead to more consistent results.
            </p>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {streamContent && (
            <div className="ai-response">
              <h3>AI Response:</h3>
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
              Cancel
            </button>
            <button 
              type="submit" 
              className="submit-button"
              disabled={!userRequest.trim() || isProcessing}
            >
              {isProcessing ? 'AI Processing...' : 'Request AI Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIEditModal;