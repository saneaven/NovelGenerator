import React, { useState, useRef, useEffect } from 'react';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { streamCopilot } from '../llm_request/copilot';
import type { ConversationBlock } from '../llm_request/types';
import type { StoryObjectCategory } from '../types/storyObject';
import { AIEditService, type ContextOptions } from '../services/aiEditService';

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: StoryObjectCategory;
  projectId: string;
  targetId?: string; // null for category-wide editing
  onResult: (result: any) => void;
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
  const settingsStore = useSettingsStore();
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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    setIsProcessing(true);
    setStreamContent('');
    setError(null);

    try {
      abortControllerRef.current = new AbortController();
      
      const storyObjects = storyObjectStore.getStoryObjects(projectId);
      
      // Prepare AI edit request using the service
      const editRequest = AIEditService.prepareEditRequest({
        category,
        targetId,
        userRequest,
        contextOptions,
        storyObjects,
        outputLanguage: settingsStore.settings.outputLanguage,
      });

      let fullResponse = '';
      
      for await (const chunk of streamCopilot(editRequest.messages, {
        signal: abortControllerRef.current.signal,
        temperature: 0.3,
        model: settingsStore.settings.aiModel,
      })) {
        fullResponse += chunk;
        setStreamContent(fullResponse);
      }

      // Parse and validate JSON response using the service
      try {
        const parsedResult = AIEditService.parseAIResponse(fullResponse);
        
        // Validate the result
        const validation = AIEditService.validateResult(parsedResult, category, targetId);
        if (!validation.isValid) {
          setError(`Invalid AI response: ${validation.errors.join(', ')}`);
          return;
        }
        
        // Apply the result
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

  const categoryDisplayName = AIEditService.getCategoryDisplayName(category);
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
                    {AIEditService.getCategoryDisplayName(key as StoryObjectCategory)}
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