import type { 
  PostProcessor, 
  PostProcessingResult, 
  ProcessedChatMessage, 
  ChatPipelineContext 
} from '../types';

export class DefaultPostProcessor implements PostProcessor {
  process(
    aiResponse: string,
    context: ChatPipelineContext
  ): PostProcessingResult {
    // Create basic processed message
    const message: ProcessedChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date(),
      originalContent: aiResponse
    };

    // Post-processing pipeline is currently empty
    // Future features like permanent content transformation can be added here

    return {
      message,
      extractedEditTags: [] // Edit tags are extracted in display-processing
    };
  }
}