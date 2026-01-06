import { registerTaskSpecs } from './specs/specRegistry';
import { aiEditSpec } from './specs/aiEditSpec';
import { translateObjectsSpec } from './specs/translateObjectsSpec';
import { agentSpec } from './specs/agentSpec';
import { agentTranslationSpec } from './specs/agentTranslationSpec';
import { imagePromptSpec, sceneImageSpec } from './specs/imagePromptSpec';

registerTaskSpecs({
  aiEdit: aiEditSpec,
  translateObjects: translateObjectsSpec,
  agent: agentSpec,
  agentTranslation: agentTranslationSpec,
  imagePrompt: imagePromptSpec,
  sceneImage: sceneImageSpec,
});
