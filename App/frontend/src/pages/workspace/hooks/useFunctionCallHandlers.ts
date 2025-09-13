import { useState } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useStoryObjectStore } from '../../../store/storyObjectStore';
import { useErrorStore } from '../../../store/errorStore';
import { FunctionCallApplicator } from '../../../chat/utils/functionCallApplicator';
import { FunctionCallService } from '../services/FunctionCallService';
import type { FunctionCallMetadata } from '../../../llm_request/types';
import type { EditCard } from '../../../chat/types';
import type { RuntimeProcessor } from '../../../chat/processors/RuntimeProcessor';

export function useFunctionCallHandlers(
  projectId: string | undefined,
  runtimeProcessor: RuntimeProcessor | null
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus } = useChatStore();
  const storyObjectStore = useStoryObjectStore();
  const { showError } = useErrorStore();
  
  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new FunctionCallApplicator(storyObjectStore));
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});
  const [pendingFunctionCallResults, setPendingFunctionCallResults] = useState<Array<{
    functionCall: FunctionCallMetadata;
    accepted: boolean;
    resultMessage: string;
  }>>([]);

  const createFunctionCallApplyHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);
        
        if (result.success) {
          updateFunctionCallStatus(projectId, messageId, functionCall.id, true, result);
          
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card => 
              card.id === functionCall.id 
                ? { 
                    ...card, 
                    isApplied: true,
                    appliedAt: new Date(),
                    title: '✅ Applied by User',
                    description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} was successfully applied`
                  }
                : card
            ) || []
          }));
          
          // Store function call result for later system message integration
          setPendingFunctionCallResults(prev => [...prev, {
            functionCall,
            accepted: true,
            resultMessage: result.message
          }]);
        } else {
          console.error('Failed to apply function call:', result.error || result.message);
          showError('Function Call Failed', `Failed to apply changes: ${result.error || result.message}`);
          
          updateFunctionCallStatus(projectId, messageId, functionCall.id, false, result, result.error);
          
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card => 
              card.id === functionCall.id 
                ? { 
                    ...card, 
                    isApplied: true,
                    appliedAt: new Date(),
                    title: '❌ Apply Failed',
                    description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} failed: ${result.error || result.message}`
                  }
                : card
            ) || []
          }));
        }
      } catch (error) {
        console.error('Error applying function call:', error);
        showError('Function Call Error', 'An error occurred while applying changes. Please try again.');
        
        updateFunctionCallStatus(projectId, messageId, functionCall.id, false, undefined, error instanceof Error ? error.message : 'Unknown error');
        
        setMessageEditCards(prev => ({
          ...prev,
          [messageId]: prev[messageId]?.map(card => 
            card.id === functionCall.id 
              ? { 
                  ...card, 
                  isApplied: true,
                  appliedAt: new Date(),
                  title: '❌ Apply Error',
                  description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
              : card
          ) || []
        }));
      }
    };
  };

  const createFunctionCallRejectHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;
      
      updateFunctionCallStatus(projectId, messageId, functionCall.id, true);
      
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => 
          card.id === functionCall.id 
            ? { 
                ...card, 
                isApplied: true,
                appliedAt: new Date(),
                title: '❌ Rejected by User',
                description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} was rejected by user`
              }
            : card
        ) || []
      }));
      
      // Store function call rejection for later system message integration
      setPendingFunctionCallResults(prev => [...prev, {
        functionCall,
        accepted: false,
        resultMessage: 'User rejected the function call'
      }]);
    };
  };


  const handleFunctionCalls = (messageId: string, functionCalls: FunctionCallMetadata[]) => {
    console.log('useFunctionCallHandlers: handleFunctionCalls called', { messageId, functionCalls, projectId });
    if (!projectId) return;
    
    updateMessageFunctionCalls(projectId, messageId, functionCalls);
    
    const functionCallCards = functionCalls.map(funcCall => ({
      id: funcCall.id,
      type: FunctionCallService.mapFunctionToEditType(funcCall.function_name),
      title: FunctionCallService.getFunctionCallTitle(funcCall.function_name),
      description: FunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
      isApplied: funcCall.isApplied,
      data: funcCall.arguments,
      appliedAt: funcCall.appliedAt, // Include appliedAt timestamp
      onApply: createFunctionCallApplyHandler(messageId, funcCall),
      onReject: createFunctionCallRejectHandler(messageId, funcCall)
    }));
    
    setMessageEditCards(prev => ({
      ...prev,
      [messageId]: functionCallCards
    }));
    
    // Clear active function calls as they're now finalized
    setActiveFunctionCalls(prev => {
      const updated = { ...prev };
      delete updated[messageId];
      return updated;
    });
  };


  const handleFunctionCallsDetected = (messageId: string, functionCalls: any[]) => {
    setActiveFunctionCalls(prev => ({
      ...prev,
      [messageId]: functionCalls
    }));
  };

  return {
    messageEditCards,
    setMessageEditCards,
    activeFunctionCalls,
    pendingFunctionCallResults,
    setPendingFunctionCallResults,
    handleFunctionCalls,
    handleFunctionCallsDetected,
    createFunctionCallApplyHandler,
    createFunctionCallRejectHandler,
  };
}