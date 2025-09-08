// streamCopilot.ts
import { type ConversationBlock } from "./types";

/**
 * FastAPI의 `/copilot/stream` 엔드포인트로 ConversationBlock[]을 보내고
 * SSE(토큰 스트리밍)를 AsyncGenerator<string>으로 돌려줍니다.
 */
export async function* streamCopilot(
  messages: ConversationBlock[],
  opts?: {
    endpoint?: string;           // 기본: /copilot/stream
    signal?: AbortSignal;        // 취소 신호
    temperature?: number;        // 0-1 범위
    model?: string;              // AI 모델 이름
  }
): AsyncGenerator<string> {
  const endpoint = opts?.endpoint ?? "/copilot/stream";

  // 요청 바디 구성
  const requestBody: any = { messages };
  if (opts?.temperature !== undefined) {
    requestBody.temperature = opts.temperature;
  }
  if (opts?.model) {
    requestBody.model = opts.model;
  }

  const res = await fetch("http://localhost:8000"+endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: opts?.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const errorMessage = text ? text : `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`Backend Error (${res.status}): ${errorMessage}`);
  }

  // SSE 프레임 파서
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE는 빈 줄(\n\n)로 이벤트 프레임 구분
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      // 주석/핑 프레임 무시
      if (!frame || frame.startsWith(":")) continue;

      // 에러 이벤트 처리
      if (frame.startsWith("event: error")) {
        const dataMatch = frame.match(/data:\s*(.+)/);
        if (dataMatch) {
          try {
            const errorData = JSON.parse(dataMatch[1]);
            throw new Error(`Backend Error: ${errorData.message || 'Unknown error'}`);
          } catch (parseError) {
            throw new Error(`Backend Error: ${dataMatch[1]}`);
          }
        }
        throw new Error('Backend Error: Unknown error occurred');
      }

      // 여러 줄 중 data: 만 모아 처리
      const dataLines = frame
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());

      for (const data of dataLines) {
        if (!data) continue;
        if (data === "[DONE]") return;

        // OpenAI 호환 스트림: choices[0].delta.content 누적
        try {
          const chunk = JSON.parse(data);
          const delta = chunk?.choices?.[0]?.delta;
          const content: string | undefined = delta?.content;
          if (content) yield content;

          const finish = chunk?.choices?.[0]?.finish_reason;
          if (finish && finish !== null) return; // "stop", "length" 등
        } catch {
          // 혹시 JSON이 아니면(서버 에러 data) 그대로 토스
          yield data;
        }
      }
    }
  }
}
