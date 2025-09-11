import type { 
  PostProcessor, 
  PostProcessingResult, 
  ProcessedChatMessage, 
  ChatPipelineContext 
} from '../types';
import type { FunctionCall } from '../../llm_request/types';

export class DefaultPostProcessor implements PostProcessor {
  process(
    aiResponse: string | { content: string | null; tool_calls?: any[] },
    context: ChatPipelineContext
  ): PostProcessingResult {
    let content: string | null;
    let tool_calls: any[] | undefined;

    // Handle different response formats
    if (typeof aiResponse === 'string') {
      content = aiResponse;
    } else {
      content = aiResponse.content;
      tool_calls = aiResponse.tool_calls;
    }

    // Create basic processed message
    const message: ProcessedChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: content,
      timestamp: new Date(),
      originalContent: content ?? undefined
    };

    // Process tool calls if present
    if (tool_calls && tool_calls.length > 0) {
      const functionCallsMetadata = tool_calls.map(toolCall => {
        let parsedArguments = {};
        
        try {
          // arguments가 유효한 JSON인지 확인
          if (toolCall.function?.arguments && toolCall.function.arguments.trim()) {
            parsedArguments = JSON.parse(toolCall.function.arguments);
          }
        } catch (error) {
          console.error('Failed to parse tool call arguments:', error, 'Raw arguments:', toolCall.function?.arguments);
          // JSON 파싱 실패해도 계속 진행
        }
        
        return {
          id: toolCall.id || crypto.randomUUID(),
          function_name: toolCall.function?.name || 'unknown',
          arguments: parsedArguments,
          isApplied: false
        };
      });
      
      message.functionCalls = functionCallsMetadata;
    }

    return {
      message,
      extractedEditTags: [] // Legacy support - edit tags are extracted in display-processing
    };
  }
}