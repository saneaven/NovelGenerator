/**
 * SceneImageGeneratorModal - Modal for generating scene images with story context
 *
 * Features:
 * - Prompt input with AI assist
 * - Reference objects from story (characters, locations, etc.)
 * - Reference image selection for image-to-image generation
 * - Scene context (pre/post text)
 * - Provider/model/size settings
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useSettingsStore, type ImageProviderType } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { Asset, ReferenceImage, ReferenceObject, ImageProvider } from '../../api/assetService';
import { assetService } from '../../api/assetService';
import { LLMRequestManager } from '../../chat/sessions/LLMRequestManager';
import { LLMRequestPipeline } from '../../chat/LLMRequestPipeline';
import type { SceneImagePromptContext, ImageReferenceObject } from '../../chat/managers/SystemPromptManager';
import { SCENE_IMAGE_PROMPT_FUNCTION } from '../../chat/types/imagePromptFunctionSchemas';
import ObjectImagePickerModal from './ObjectImagePickerModal';
import './SceneImageGeneratorModal.css';

// Story object types
type StoryObjectType = 'character' | 'location' | 'organization' | 'lorebook';

interface SceneContext {
  preContext: string;
  postContext: string;
}

interface ReferenceObjectWithImage {
  id: string;
  type: StoryObjectType;
  name: string;
  selectedAssetId?: string;  // Selected image asset for this object
  selectedAssetUrl?: string; // Thumbnail URL for display
}

interface SceneImageGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageGenerated: (asset: Asset) => void;
  sceneContext?: SceneContext;
}

// Provider configuration
const PROVIDER_LABELS: Record<ImageProviderType, string> = {
  openai: 'OpenAI (DALL-E / GPT-Image)',
  gemini: 'Gemini',
  xai: 'xAI (Grok)',
  novelai: 'NovelAI',
};

const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
  openai: [
    { id: 'gpt-image-1', name: 'GPT Image 1' },
    { id: 'dall-e-3', name: 'DALL-E 3' },
    { id: 'dall-e-2', name: 'DALL-E 2' },
  ],
  gemini: [
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview' },
    { id: 'gemini-2.0-flash-preview-image-generation', name: 'Gemini 2.0 Flash Image' },
  ],
  xai: [
    { id: 'grok-2-image', name: 'Grok 2 Image' },
    { id: 'grok-2-image-1212', name: 'Grok 2 Image 1212' },
  ],
  novelai: [
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
  ],
};

const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
  openai: ['1024x1024', '1024x1792', '1792x1024'],
  gemini: [],
  xai: ['1024x1024', '1024x1792', '1792x1024'],
  novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

const GEMINI_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'];

const OBJECT_TYPE_LABELS: Record<StoryObjectType, string> = {
  character: 'Character',
  location: 'Location',
  organization: 'Organization',
  lorebook: 'Lorebook',
};

const OBJECT_TYPE_ICONS: Record<StoryObjectType, string> = {
  character: '👤',
  location: '📍',
  organization: '🏢',
  lorebook: '📖',
};

const SceneImageGeneratorModal: React.FC<SceneImageGeneratorModalProps> = ({
  isOpen,
  onClose,
  onImageGenerated,
  sceneContext,
}) => {
  const { currentProjectId } = useProjectStore();
  const { isGenerating, error, generateImage, clearError } = useAssetStore();
  const { settings } = useSettingsStore();
  const { listObjects } = useUnifiedObjectStore();

  // Provider info with image input support
  const [providers, setProviders] = useState<ImageProvider[]>([]);

  // Form state
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<ImageProviderType>(settings.imageGenConfig.provider);
  const [model, setModel] = useState(settings.imageGenConfig.model);
  const [size, setSize] = useState(settings.imageGenConfig.size);
  const [geminiAspectRatio, setGeminiAspectRatio] = useState(settings.imageGenConfig.geminiSettings.aspect_ratio);
  const [geminiResolution, setGeminiResolution] = useState(settings.imageGenConfig.geminiSettings.image_resolution);

  // Reference objects with optional images
  const [referenceObjects, setReferenceObjects] = useState<ReferenceObjectWithImage[]>([]);

  // All story objects for AI prompt generation
  const [allStoryObjects, setAllStoryObjects] = useState<ImageReferenceObject[]>([]);

  // Object picker modal
  const [showObjectPicker, setShowObjectPicker] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imagePickerObjectId, setImagePickerObjectId] = useState<string | null>(null);

  // AI prompt generation state
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRunnerRef = useRef<LLMRequestManager | null>(null);

  // Load providers on mount
  useEffect(() => {
    if (isOpen) {
      assetService.listImageProviders().then(setProviders).catch(console.error);
    }
  }, [isOpen]);

  // Load all story objects for AI prompt generation
  useEffect(() => {
    if (!isOpen || !currentProjectId) return;

    const loadAllObjects = async () => {
      const allObjects: ImageReferenceObject[] = [];
      const objectTypes: StoryObjectType[] = ['character', 'location', 'organization', 'lorebook'];

      for (const objType of objectTypes) {
        try {
          const objects = await listObjects(objType, currentProjectId);
          for (const obj of objects) {
            const data = obj.data[settings.mainLanguage] || Object.values(obj.data)[0] || {};
            allObjects.push({
              id: obj.id,
              type: objType,
              name: data.name || data.title || obj.id,
              description: data.description || '',
            });
          }
        } catch (err) {
          console.error(`Failed to load ${objType} objects:`, err);
        }
      }

      setAllStoryObjects(allObjects);
    };

    loadAllObjects();
  }, [isOpen, currentProjectId, listObjects, settings.mainLanguage]);

  // Check if current provider supports image input
  const supportsImageInput = useMemo(() => {
    const currentProvider = providers.find(p => p.name === provider);
    return currentProvider?.supports_image_input ?? false;
  }, [providers, provider]);

  // Get API key for current provider
  const getApiKey = useCallback((): string => {
    switch (provider) {
      case 'openai':
        return settings.providerCredentials.openai.apiKey;
      case 'gemini':
        return settings.providerCredentials.gemini.apiKey;
      case 'xai':
        return settings.providerCredentials.xai?.apiKey || '';
      case 'novelai':
        return settings.providerCredentials.novelai?.apiKey || '';
      default:
        return '';
    }
  }, [provider, settings.providerCredentials]);

  // Add reference object
  const handleAddObject = useCallback((objectId: string, objectType: StoryObjectType, objectName: string) => {
    // Check if already added
    if (referenceObjects.some(obj => obj.id === objectId)) return;

    setReferenceObjects(prev => [
      ...prev,
      { id: objectId, type: objectType, name: objectName }
    ]);
  }, [referenceObjects]);

  // Remove reference object
  const handleRemoveObject = useCallback((objectId: string) => {
    setReferenceObjects(prev => prev.filter(obj => obj.id !== objectId));
  }, []);

  // Open image picker for an object
  const handleSelectImage = useCallback((objectId: string) => {
    setImagePickerObjectId(objectId);
    setShowImagePicker(true);
  }, []);

  // Set selected image for object
  const handleImageSelected = useCallback((assetId: string, assetUrl: string) => {
    if (!imagePickerObjectId) return;

    setReferenceObjects(prev =>
      prev.map(obj =>
        obj.id === imagePickerObjectId
          ? { ...obj, selectedAssetId: assetId, selectedAssetUrl: assetUrl }
          : obj
      )
    );
    setShowImagePicker(false);
    setImagePickerObjectId(null);
  }, [imagePickerObjectId]);

  // Clear selected image for object
  const handleClearImage = useCallback((objectId: string) => {
    setReferenceObjects(prev =>
      prev.map(obj =>
        obj.id === objectId
          ? { ...obj, selectedAssetId: undefined, selectedAssetUrl: undefined }
          : obj
      )
    );
  }, []);

  // Get native output mode setting
  const isNativeOutput = settings.nativeOutputMode;

  // AI prompt generation using scene context and all available objects
  const handleAIPromptGeneration = useCallback(async () => {
    if (!sceneContext) {
      setPromptError('Scene context is required for AI prompt generation');
      return;
    }

    setIsGeneratingPrompt(true);
    setPromptError(null);

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];

    try {
      // Build SceneImagePromptContext
      const promptContext: SceneImagePromptContext = {
        userRequest: '', // User can optionally add guidance
        promptMode: 'natural', // Default to natural language prompts
        scenePreContext: sceneContext.preContext,
        scenePostContext: sceneContext.postContext,
        availableObjects: allStoryObjects,
        isNativeOutput,
      };

      const systemInsertConfig = {
        enabled: true,
        includeProjectInfo: false,
        includeStoryObjects: false,
        includeNovelContent: false,
        promptType: 'sceneImagePrompt' as const,
        promptContext,
      };

      let selectedObjectIds: string[] = [];

      taskRunnerRef.current = new LLMRequestManager(
        {
          projectId: currentProjectId || '',
          getStoryObjects: () => ({}),
          systemInsertConfig,
          chatPipeline: new LLMRequestPipeline(),
          provider: imagePromptConfig.provider,
          providerConfig,
          aiModel: imagePromptConfig.model,
          temperature: imagePromptConfig.temperature,
          mode: 'workspace',
          enablePrefill: false,
          retryConfig: settings.retryConfig,
          abortControllerRef,
          // Function calling configuration - skip when in native output mode
          functions: isNativeOutput ? undefined : [SCENE_IMAGE_PROMPT_FUNCTION],
          toolChoice: isNativeOutput ? undefined : 'required',
        },
        {
          onStreamUpdate: (contentParts) => {
            const text = contentParts
              .filter(part => part.type === 'content')
              .map(part => part.text)
              .join('');
            if (text) {
              // Native mode: always update (continuous streaming)
              // Function mode: only show intermediate content before function call
              if (isNativeOutput) {
                setPrompt(text);
              }
            }
          },
          onFunctionCalls: isNativeOutput ? undefined : async (functionCalls) => {
            const call = functionCalls.find(c => c.function_name === 'generate_scene_image_prompt');
            if (call && call.arguments) {
              try {
                const args = typeof call.arguments === 'string'
                  ? JSON.parse(call.arguments)
                  : call.arguments;

                if (args.prompt) {
                  setPrompt(args.prompt);
                }

                if (args.reference_object_ids && Array.isArray(args.reference_object_ids)) {
                  selectedObjectIds = args.reference_object_ids;
                }
              } catch (e) {
                console.error('Failed to parse function call arguments:', e);
                setPromptError('Failed to parse generated prompt');
              }
            }
          },
          onFinalMessage: async (message) => {
            // In native mode, use text content directly
            if (isNativeOutput) {
              const text = message.contentParts
                ?.filter(part => part.type === 'content')
                .map(part => part.text)
                .join('') || '';
              if (text.trim()) {
                setPrompt(text.trim());
              } else {
                setPromptError('AI did not generate a prompt. Please try again.');
              }
              return; // Skip reference object processing in native mode
            }
            // After generation completes, populate reference objects with main images
            if (selectedObjectIds.length > 0) {
              const newReferenceObjects: ReferenceObjectWithImage[] = [];

              for (const objId of selectedObjectIds) {
                const objInfo = allStoryObjects.find(o => o.id === objId);
                if (!objInfo) continue;

                const refObj: ReferenceObjectWithImage = {
                  id: objId,
                  type: objInfo.type as StoryObjectType,
                  name: objInfo.name,
                };

                // Try to get main image for this object
                if (currentProjectId) {
                  try {
                    const response = await assetService.getStoryObjectAssets(
                      currentProjectId,
                      objInfo.type,
                      objId
                    );

                    // Use main asset or first available
                    const mainAsset = response.main_asset?.asset || response.assets[0]?.asset;
                    if (mainAsset) {
                      refObj.selectedAssetId = mainAsset.id;
                      refObj.selectedAssetUrl = mainAsset.thumbnail_url || mainAsset.file_url;
                    }
                  } catch (err) {
                    console.error(`Failed to load assets for object ${objId}:`, err);
                  }
                }

                newReferenceObjects.push(refObj);
              }

              setReferenceObjects(newReferenceObjects);
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') return;
            console.error('Failed to generate scene prompt:', err);
            setPromptError(err.message || 'Failed to generate prompt');
          },
        }
      );

      await taskRunnerRef.current.run(null, {
        history: [],
        language: settings.mainLanguage,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to generate scene prompt:', err);
      setPromptError(err instanceof Error ? err.message : 'Failed to generate prompt');
    } finally {
      setIsGeneratingPrompt(false);
      taskRunnerRef.current = null;
    }
  }, [sceneContext, allStoryObjects, settings, currentProjectId]);

  // Generate image
  const handleGenerate = async () => {
    if (!currentProjectId || !prompt.trim()) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      alert(`Please configure your ${PROVIDER_LABELS[provider]} API key in Settings > Credentials`);
      return;
    }

    try {
      clearError();

      // Build reference images (only for objects that have selected images)
      const referenceImagesData: ReferenceImage[] = referenceObjects
        .filter(obj => obj.selectedAssetId)
        .map(obj => ({
          asset_id: obj.selectedAssetId!,
          strength: 0.7,
        }));

      // Build reference objects data for metadata
      const referenceObjectsData: ReferenceObject[] = referenceObjects.map(obj => ({
        id: obj.id,
        type: obj.type,
        name: obj.name,
      }));

      const requestParams: any = {
        prompt: prompt.trim(),
        provider,
        model,
        size: provider === 'gemini' ? undefined : size,
        reference_objects: referenceObjectsData.length > 0 ? referenceObjectsData : undefined,
      };

      // Add reference images if provider supports it
      if (supportsImageInput && referenceImagesData.length > 0) {
        requestParams.reference_images = referenceImagesData;
      }

      // Add Gemini-specific settings
      if (provider === 'gemini') {
        requestParams.provider_settings = {
          aspect_ratio: geminiAspectRatio,
          image_resolution: geminiResolution,
        };
      }

      const asset = await generateImage(currentProjectId, requestParams, apiKey);

      if (asset) {
        onImageGenerated(asset);
        onClose();
      }
    } catch (err) {
      console.error('Image generation failed:', err);
    }
  };

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt('');
      setReferenceObjects([]);
      clearError();
    }
  }, [isOpen, clearError]);

  if (!isOpen) return null;

  const currentModelOptions = MODEL_OPTIONS[provider] || [];
  const currentSizeOptions = SIZE_OPTIONS[provider] || ['1024x1024'];

  return (
    <div className="scene-image-generator-overlay" onClick={onClose}>
      <div className="scene-image-generator-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Generate Scene Image</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Scene Context Info */}
          {sceneContext && (sceneContext.preContext || sceneContext.postContext) && (
            <div className="scene-context-info">
              <span className="context-label">Scene context will be included in prompt generation</span>
            </div>
          )}

          {/* Prompt Input */}
          <div className="form-section">
            <label>Prompt</label>
            <div className="prompt-input-wrapper">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the scene image you want to generate..."
                rows={4}
                className="prompt-input"
              />
              <button
                className="ai-assist-btn"
                onClick={handleAIPromptGeneration}
                disabled={isGeneratingPrompt || !sceneContext}
                title={!sceneContext ? 'Scene context required' : 'AI-assisted prompt generation'}
                type="button"
              >
                {isGeneratingPrompt ? 'Generating...' : '✨ AI Assist'}
              </button>
            </div>
            {promptError && (
              <div className="prompt-error">{promptError}</div>
            )}
          </div>

          {/* Reference Objects Section */}
          <div className="form-section">
            <div className="section-header">
              <label>Reference Objects</label>
              <button
                className="add-object-btn"
                onClick={() => setShowObjectPicker(true)}
                type="button"
              >
                + Add Object
              </button>
            </div>

            {referenceObjects.length === 0 ? (
              <div className="empty-objects">
                <span>No reference objects added</span>
                <span className="hint">Add characters, locations, or other story objects to include in generation</span>
              </div>
            ) : (
              <div className="reference-objects-list">
                {referenceObjects.map(obj => (
                  <div key={obj.id} className="reference-object-item">
                    <div className="object-info">
                      <span className="object-icon">{OBJECT_TYPE_ICONS[obj.type]}</span>
                      <span className="object-name">{obj.name}</span>
                      <span className="object-type">{OBJECT_TYPE_LABELS[obj.type]}</span>
                    </div>

                    {/* Image placeholder/preview */}
                    <div className="object-image-section">
                      {obj.selectedAssetUrl ? (
                        <div className="selected-image">
                          <img src={obj.selectedAssetUrl} alt={obj.name} />
                          <div className="image-actions">
                            <button
                              className="change-image-btn"
                              onClick={() => handleSelectImage(obj.id)}
                              title="Change image"
                            >
                              🔄
                            </button>
                            <button
                              className="clear-image-btn"
                              onClick={() => handleClearImage(obj.id)}
                              title="Remove image"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className={`image-placeholder ${supportsImageInput ? '' : 'disabled'}`}
                          onClick={() => supportsImageInput && handleSelectImage(obj.id)}
                          title={supportsImageInput ? 'Select reference image' : 'Provider does not support image input'}
                          disabled={!supportsImageInput}
                        >
                          <span className="placeholder-icon">🖼️</span>
                          <span className="placeholder-text">
                            {supportsImageInput ? 'Add Image' : 'No image support'}
                          </span>
                        </button>
                      )}
                    </div>

                    <button
                      className="remove-object-btn"
                      onClick={() => handleRemoveObject(obj.id)}
                      title="Remove object"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!supportsImageInput && referenceObjects.length > 0 && (
              <div className="image-support-notice">
                <span>💡 {PROVIDER_LABELS[provider]} does not support image-to-image generation. Only object metadata will be used.</span>
              </div>
            )}
          </div>

          {/* Provider Settings */}
          <div className="form-section settings-section">
            <div className="form-row">
              <div className="form-field">
                <label>Provider</label>
                <select
                  value={provider}
                  onChange={(e) => {
                    const newProvider = e.target.value as ImageProviderType;
                    setProvider(newProvider);
                    setModel(MODEL_OPTIONS[newProvider]?.[0]?.id || '');
                    setSize(SIZE_OPTIONS[newProvider]?.[0] || '1024x1024');
                  }}
                  className="config-select"
                >
                  {(Object.keys(PROVIDER_LABELS) as ImageProviderType[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="config-select"
                >
                  {currentModelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              {provider === 'gemini' ? (
                <>
                  <div className="form-field">
                    <label>Aspect Ratio</label>
                    <select
                      value={geminiAspectRatio}
                      onChange={(e) => setGeminiAspectRatio(e.target.value)}
                      className="config-select"
                    >
                      {GEMINI_ASPECT_RATIOS.map((ar) => (
                        <option key={ar} value={ar}>{ar}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Resolution</label>
                    <select
                      value={geminiResolution}
                      onChange={(e) => setGeminiResolution(e.target.value)}
                      className="config-select"
                    >
                      {GEMINI_RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <div className="form-field">
                  <label>Size</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="config-select"
                  >
                    {currentSizeOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? 'Generating...' : 'Generate Image'}
          </button>
        </div>

        {/* Object Picker Sub-modal */}
        {showObjectPicker && (
          <ObjectPickerModal
            isOpen={showObjectPicker}
            onClose={() => setShowObjectPicker(false)}
            onSelect={handleAddObject}
            excludeIds={referenceObjects.map(obj => obj.id)}
          />
        )}

        {/* Image Picker Sub-modal */}
        {showImagePicker && imagePickerObjectId && (
          <ObjectImagePickerModal
            isOpen={showImagePicker}
            onClose={() => {
              setShowImagePicker(false);
              setImagePickerObjectId(null);
            }}
            objectId={imagePickerObjectId}
            objectType={referenceObjects.find(obj => obj.id === imagePickerObjectId)?.type || 'character'}
            onImageSelected={handleImageSelected}
          />
        )}

      </div>
    </div>
  );
};

// Simple Object Picker Modal (inline)
interface ObjectPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (objectId: string, objectType: StoryObjectType, objectName: string) => void;
  excludeIds: string[];
}

const ObjectPickerModal: React.FC<ObjectPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  excludeIds,
}) => {
  const { currentProjectId } = useProjectStore();
  const { settings } = useSettingsStore();
  const { listObjects } = useUnifiedObjectStore();
  const [activeTab, setActiveTab] = useState<StoryObjectType>('character');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadedObjects, setLoadedObjects] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load objects when tab changes or modal opens
  useEffect(() => {
    if (!isOpen || !currentProjectId) return;

    const loadObjects = async () => {
      setIsLoading(true);
      try {
        const objects = await listObjects(activeTab, currentProjectId);
        // Extract name from data - try main language first, then fallback to first available
        const mappedObjects = objects.map(obj => {
          const mainLang = settings.mainLanguage;
          const data = obj.data[mainLang] || obj.data[Object.keys(obj.data)[0]] || {};
          return {
            id: obj.id,
            name: data.name || data.title || obj.id,
          };
        });
        setLoadedObjects(mappedObjects);
      } catch (err) {
        console.error('Failed to load objects:', err);
        setLoadedObjects([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadObjects();
  }, [isOpen, currentProjectId, activeTab, listObjects, settings.mainLanguage]);

  const filteredObjects = useMemo(() => {
    return loadedObjects.filter(obj =>
      !excludeIds.includes(obj.id) &&
      obj.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [loadedObjects, excludeIds, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="object-picker-overlay" onClick={onClose}>
      <div className="object-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>Add Reference Object</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="picker-tabs">
          {(Object.keys(OBJECT_TYPE_LABELS) as StoryObjectType[]).map(type => (
            <button
              key={type}
              className={`picker-tab ${activeTab === type ? 'active' : ''}`}
              onClick={() => setActiveTab(type)}
            >
              {OBJECT_TYPE_ICONS[type]} {OBJECT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <div className="picker-search">
          <input
            type="text"
            placeholder={`Search ${OBJECT_TYPE_LABELS[activeTab].toLowerCase()}s...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="picker-list">
          {isLoading ? (
            <div className="picker-empty">Loading...</div>
          ) : filteredObjects.length === 0 ? (
            <div className="picker-empty">
              No {OBJECT_TYPE_LABELS[activeTab].toLowerCase()}s found
            </div>
          ) : (
            filteredObjects.map(obj => (
              <button
                key={obj.id}
                className="picker-item"
                onClick={() => {
                  onSelect(obj.id, activeTab, obj.name);
                  onClose();
                }}
              >
                <span className="item-icon">{OBJECT_TYPE_ICONS[activeTab]}</span>
                <span className="item-name">{obj.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SceneImageGeneratorModal;
