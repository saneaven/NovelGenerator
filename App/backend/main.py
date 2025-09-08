# main.py
# pip install fastapi "uvicorn[standard]" httpx python-dotenv
import os
import json
from dotenv import load_dotenv
from typing import List, Literal, Optional
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from pydantic import BaseModel
import httpx

load_dotenv()

COPILOT_URL = "https://api.githubcopilot.com/chat/completions"
COPILOT_TOKEN = os.getenv("COPILOT_TOKEN")
# ---- 모델 ----
Role = Literal["system", "user", "assistant"]

class ConversationBlock(BaseModel):
    role: Role
    content: str

class ChatIn(BaseModel):
    messages: List[ConversationBlock]
    temperature: Optional[float] = 0.7
    model: Optional[str] = "claude-sonnet-4"

# ---- 앱/미들웨어 ----
app = FastAPI()

# 필요 시 CORS 조정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- 라우트 ----
@app.post("/copilot/stream")
async def copilot_stream(
    payload: ChatIn,
    request: Request,
):

    upstream_headers = {
        "authorization": f"Bearer {COPILOT_TOKEN}",
        "content-type": "application/json",
    }
    upstream_body = {
        "messages": [m.model_dump() for m in payload.messages],
        "stream": True,
        "temperature": payload.temperature,
        "model": payload.model
        # 필요시 추가 OpenAI 호환 파라미터:
        # "tools": [...],
        # "tool_choice": "auto",
    }

    async def event_gen():
        MAX_RETRIES = 5
        retry_count = 0
        
        while retry_count < MAX_RETRIES:
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST",
                        COPILOT_URL,
                        headers=upstream_headers,
                        json=upstream_body,
                    ) as r:
                        # 에러면 본문 읽어서 SSE 형태로 포워딩
                        if r.status_code >= 400:
                            text = await r.aread()
                            err_msg = text.decode("utf-8", errors="ignore") or r.reason_phrase

                            print(r.status_code, err_msg)  # 로깅용
                            
                            # 5xx 에러는 재시도, 4xx 에러는 바로 실패
                            if (r.status_code >= 500 or r.status_code == 403) and retry_count < MAX_RETRIES - 1:
                                retry_count += 1
                                continue
                            else:
                                yield f"event: error\ndata: {json.dumps({'status': r.status_code, 'message': err_msg})}\n\n"
                                return

                        async for chunk in r.aiter_bytes():
                            # Copilot → 클라이언트로 SSE 바이트 그대로 전달
                            if chunk:
                                yield chunk
                        return  # 성공적으로 완료되면 반복문 탈출
                        
            except httpx.RequestError as e:
                # 네트워크 오류는 재시도
                retry_count += 1
                if retry_count >= MAX_RETRIES:
                    yield f"event: error\ndata: {json.dumps({'message': f'네트워크 오류 ({MAX_RETRIES}회 재시도 실패): {str(e)}'})}\n\n"
                    return
            except Exception as e:
                # 기타 예외는 바로 실패
                yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
                return

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.get("/healthz")
def healthz():
    return PlainTextResponse("ok")
