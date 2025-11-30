import type {
  PostProcessor,
  PostProcessingResult,
  ProcessedChatMessage,
  ChatPipelineContext
} from '../types';
import type { ThinkingDetail, ContentPart } from '../../llm_request/types';
import { generateTempId } from '../../utils/tempId';

export class DefaultPostProcessor implements PostProcessor {
  process(
    aiResponse: any,
    _context: ChatPipelineContext
  ): PostProcessingResult {
    let contentParts: ContentPart[];
    let tool_calls: any[] | undefined;
    let thinking_details: ThinkingDetail[] | undefined;

    // Handle different response formats
    if (typeof aiResponse === 'string') {
      // Legacy: plain string content
      contentParts = [{type: 'content', text: aiResponse}];
    } else if (aiResponse.contentParts) {
      // NEW: Already structured contentParts from ChatManager
      contentParts = aiResponse.contentParts;
      tool_calls = aiResponse.tool_calls;
      thinking_details = aiResponse.thinking_details;
    } else if (aiResponse.content) {
      // Fallback: old format with plain content
      contentParts = [{type: 'content', text: aiResponse.content}];
      tool_calls = aiResponse.tool_calls;
      thinking_details = aiResponse.thinking_details;
    } else {
      // No content at all
      contentParts = [];
      tool_calls = aiResponse.tool_calls;
      thinking_details = aiResponse.thinking_details;
    }

    // Create processed message
    const message: ProcessedChatMessage = {
      id: generateTempId(),
      role: 'assistant',
      contentParts,
      timestamp: new Date(),
      thinking_details
    };

    // Process tool calls if present
    if (tool_calls && tool_calls.length > 0) {
      const functionCallsMetadata = tool_calls.map(toolCall => {
        let parsedArguments = {};

        try {
          // Check if arguments is valid JSON
          if (toolCall.function?.arguments && toolCall.function.arguments.trim()) {
            parsedArguments = JSON.parse(toolCall.function.arguments);
          }
        } catch (error) {
          console.error('Failed to parse tool call arguments:', error, 'Raw arguments:', toolCall.function?.arguments);
          // Continue processing even if JSON parsing fails
        }

        return {
          id: toolCall.id || generateTempId(),
          function_name: toolCall.function?.name || 'unknown',
          arguments: parsedArguments,
          isApplied: false
        };
      });

      message.functionCalls = functionCallsMetadata;
    }

    return {
      message
    };
  }
}

