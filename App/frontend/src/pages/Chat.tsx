import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { streamCopilot } from '../llm_request/copilot';
import { type ChatMessage, type ConversationBlock } from '../llm_request/types';

const Chat: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const { addMessage, updateMessage, getChatHistory } = useChatStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentProject = getCurrentProject();
  const chatHistory = getChatHistory(projectId || '');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !projectId || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    addMessage(projectId, userMessage);
    setInput('');
    setIsLoading(true);

    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    addMessage(projectId, assistantMessage);

    try {
      const conversationBlocks: ConversationBlock[] = [
        {
          role: 'system',
          content: `당신은 소설 창작을 도와주는 AI 어시스턴트입니다. 현재 "${currentProject?.name}" 프로젝트를 진행 중입니다. 창의적이고 건설적인 조언을 제공해주세요.`,
        },
        ...chatHistory.map((msg): ConversationBlock => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user',
          content: userMessage.content,
        },
      ];

      abortControllerRef.current = new AbortController();
      
      let accumulatedContent = '';
      for await (const chunk of streamCopilot(conversationBlocks, {
        signal: abortControllerRef.current.signal,
      })) {
        accumulatedContent += chunk;
        updateMessage(projectId, assistantMessageId, accumulatedContent);
      }
    } catch (error) {
      console.error('Chat error:', error);
      if (error instanceof Error && error.name !== 'AbortError') {
        updateMessage(
          projectId,
          assistantMessageId,
          '죄송합니다. 응답을 생성하는 중 오류가 발생했습니다. 다시 시도해주세요.'
        );
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>프로젝트를 찾을 수 없습니다</h2>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">홈</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">AI 채팅</span>
        </div>
        <h1>AI 채팅</h1>
        <p>AI와 대화하며 소설 아이디어를 발전시켜보세요</p>
      </div>

      <div className="chat-messages">
        {chatHistory.length === 0 && (
          <div className="welcome-message">
            <div className="ai-avatar">🤖</div>
            <div className="message-content">
              <p>안녕하세요! 저는 소설 창작을 도와드리는 AI 어시스턴트입니다.</p>
              <p>"{currentProject.name}" 프로젝트에 대해 무엇을 도와드릴까요?</p>
              <ul>
                <li>📖 스토리 아이디어 브레인스토밍</li>
                <li>👥 캐릭터 개발 및 설정</li>
                <li>🏛️ 배경과 세계관 구축</li>
                <li>📝 문체나 장르별 조언</li>
                <li>🎯 플롯 구성과 전개</li>
              </ul>
            </div>
          </div>
        )}

        {chatHistory.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-text">{message.content}</div>
              <div className="message-time">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-form">
          <div className="input-group">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요..."
              rows={1}
              className="chat-input"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
            />
            {isLoading ? (
              <button type="button" onClick={handleStop} className="stop-button">
                정지
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="send-button">
                전송
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default Chat;