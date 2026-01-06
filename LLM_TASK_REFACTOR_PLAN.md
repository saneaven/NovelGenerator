# LLM Task 통합 리팩터링 — 최종 Spec / 코드 설계 (Legacy 전면 제거)
작성일: 2026-01-04

이 문서는 **현재 프로젝트에서 “LLM task”를 사용하는 모든 컴포넌트들이 task를 어떻게 생성/스트리밍/알림/함수호출/결과 적용까지 처리하는지**를 **코드 레벨로 해부**하고, 그 결과로 **aiEdit ↔ translateObjects를 100% 공통 파이프라인으로 통합**하는 **최종(TO‑BE) 구조**를 정의한다.

> 금지: “단계적 마이그레이션” 같은 표현/전략.  
> 목표: legacy를 걷어내고 **최종 결과물(파일 구조 + 인터페이스 + 동작 spec + 어떤 파일을 어떻게 바꿀지)**만 제시.

---

## 0) 용어 / 정의 (Spec에서 말하는 “정확한 의미”)

### 0.1 `TaskKind`
- **TaskSpec(플러그인)의 안정적인 식별자(= registry key)**.
- “AI Edit”, “translateObjects”, “agent”, “imagePrompt”… 같은 종류를 구분하는 **문자열 ID**.
- **왜 spec에 `kind`가 있어야 하나?**
  - (1) 런타임이 spec을 lookup 하기 위한 키
  - (2) 세션에 저장해서 Notification/Retry/UI 라우팅을 **모달과 무관하게** 처리하기 위한 키
  - (3) 로깅/통계/디버그 시 “어떤 타입의 task였는지”를 확정하기 위한 키
- **중요:** `TaskKind`를 수동 union으로 관리하지 말고, registry로부터 자동 유도한다.
  - `export const TASK_SPECS = { aiEdit: aiEditSpec, translateObjects: translateObjectsSpec, ... } as const;`
  - `export type TaskKind = keyof typeof TASK_SPECS;`

### 0.2 `Input` (사용자가 물어본 “Input이 의미하는 건 뭐야?”)
- **Task를 시작할 때 필요한 “도메인 입력값(순수 데이터)”**.
- 예: `aiEdit`라면 `category/targetId/userRequest/contextIds/...`, `translateObjects`라면 `sourceLanguage/targetLanguage/objects/...`.
- **포함하면 안 되는 것(원칙):**
  - `sessionId` (런타임이 생성)
  - `AbortController` (런타임이 관리)
  - UI 콜백(함수) (모달이 사라져도 task가 계속 돌아야 하므로)
- **Input의 목적**
  - (1) TaskSpec이 프롬프트/툴 정책/적용 컨텍스트를 구성할 수 있게 하는 SSoT
  - (2) 세션에 저장해 두고 **모달 없이도 Retry를 동일 입력으로 재실행**하기 위한 SSoT

### 0.3 `Env` / `RuntimeEnv`
- 런타임이 주입하는 “환경 값”.
- 예: `projectId`, `mainLanguage`, 현재 settings snapshot, userId(있다면), nativeOutputMode 등.
- Input과 분리하는 이유: **Input은 사용자 폼 데이터**, Env는 **앱/세션 컨텍스트**.

### 0.4 `Spec`(TaskSpec)
- “Task 한 종류”를 선언적으로 정의한 객체.
- **(a) 어떤 LLM 모드/프롬프트로 실행할지**, **(b) 스트리밍 결과를 어떻게 해석할지**, **(c) 함수 호출을 어떻게 검증/승인/적용할지**를 정의한다.
- 핵심: TaskRuntime은 **Spec만 보고** 동일한 파이프라인으로 실행한다.

### 0.5 “Batch”라는 단어 제거(왜 translation만 batch라고 불렸나?)
- 현재 코드에서 translation 쪽은 `translateBatch`, `StoryTranslationPromptContext (batch)` 같은 **역사적 네이밍**이 남아있어서 그렇게 보인다.
- 하지만 실제로는 다른 오퍼레이션도 기본적으로 “여러 개 대상”을 다룬다.
- 최종안에서는 **UI/코드에서 batch라는 개념/이름을 제거**하고, `translateObjects`로 통일한다.

---

## 1) AS‑IS: 지금(현재) 코드 구조 — “LLM Task”가 어떻게 흩어져있는가 (로우레벨)

### 1.1 공통 기반(LLM 호출/스트리밍)

#### 1) `App/frontend/src/llm/LLMTask.ts`
- 역할(현재):
  - provider/model/temperature/thinking 설정을 settingsStore에서 로드
  - `PromptManager.generatePromptBundle(mode, context)`로 템플릿 렌더링
  - `PromptManager.getFunctionsForMode(mode, context)`로 함수 스키마 선택
  - `streamLLM(...)`를 for‑await로 스트리밍
  - 스트리밍 중:
    - RAF throttling으로 `onUpdate(contentParts)` 콜백 호출
    - **직접 `llmTaskStore.setContentParts(sessionId, ...)` 호출(= store mutate를 LLMTask가 수행)**
    - tool_calls 델타를 `FunctionCallStreamTracker`에 누적하고 `onFunctionProgress(progress)` 콜백 호출
  - 종료 시:
    - function calls finalize → `LLMTaskResult` 반환
    - debug info(usage/provider/model)를 `llmTaskStore.updateSession`에 기록
  - Abort:
    - 내부에서 새 `AbortController` 생성하고 `LLMTaskManager.registerAbortController(sessionId, controller)` 호출
- 문제(통합 관점):
  - **LLMTask 자체가 store를 mutate** → “Runtime 1곳” 원칙 위배(다른 파이프라인이 생길 수 있음)
  - AbortController를 store에 **등록만 하고 해제(unregister)하지 않음** → 누수 가능

#### 2) `App/frontend/src/llm/LLMTaskManager.ts`
- 역할(현재):
  - `startTask()`에서 sessionId 생성 + `llmTaskStore.setRunning(...)`
  - `complete/error/cancel/updateProgress` 바인딩된 핸들을 반환
- 문제(통합 관점):
  - “세션 생성/상태 변경”만 담당하는 얇은 유틸인데, 실제 오케스트레이션은 각 모달/서비스가 제각각 구현

#### 3) `App/frontend/src/store/llmTaskStore.ts`
- 역할(현재):
  - `sessions[sessionId]`에 status/contentParts/progress/retryContext 등을 저장(알림 UI의 source)
  - status: `'idle' | 'running' | 'pending_confirmation' | 'success' | 'error' | 'cancelled'`
  - AbortController registry(Map) 보유 + `cancelTask(sessionId)`에서 abort
- 문제(통합 관점):
  - status에 `pending_confirmation`이 있는데 **실제 코드에서 세팅하는 곳이 없음**(아래 AIEdit 버그)
  - 함수 호출 승인/카드 상태는 별도 `EditCardStore`에 있음(세션이 둘로 갈라짐)

#### 4) `App/frontend/src/llm/PromptManager.ts`
- 역할(현재):
  - 프롬프트 템플릿 로드/렌더링
  - 모드별 function schema 선택
- 문제(통합 관점):
  - translation 함수는 `App/frontend/src/llm/schemas/translationFunctions.ts`에서 가져옴(= schema가 중복 위치)
  - functionCall 쪽에는 이미 `schemaRegistry.ts`가 “SSoT”를 표방(실제로는 중복)

---

### 1.2 AI Edit 플로우(현재)

#### 1) 진입점: `App/frontend/src/components/AIEditModal.tsx`
- `handleSubmit`에서:
  1. `LLMTaskManager.startTask({ taskType:'ai-edit', label, retryContext })`
  2. `new LLMTask({ mode: EDIT_ASSISTANT_*, promptContext, sessionId }, callbacks)`
  3. `llmTask.run()` fire‑and‑forget 후 모달 닫음
- `LLMTask.onComplete`에서:
  - nativeOutputMode면 `convertNativeOutputToFunctionCalls(text)`로 함수 콜 변환
  - 아니면 `result.functionCalls` 사용
  - `processFunctionCallsForSession(functionCalls, { projectId, language: mainLanguage, sessionId })` 호출

#### 2) 함수 호출 → 카드/검증: `App/frontend/src/functionCall/hooks/useFunctionCallHandlers.ts`
- `processFunctionCallsForSession`(standalone 함수) 내부:
  1. Raw → Normalized 변환
  2. `buildEditCards(..., initialStatus:'validating')`로 카드 생성(적용/거절 핸들러 클로저 포함)
  3. `validate(normalized[])` 실행(ValidatorRegistry 기반, async)
  4. validation 결과를 카드에 반영(accepted/pending/failed 등)
  5. `EditCardStore.setCardsForSession(sessionId, cards)`
  6. **(중요) llmTaskStore의 `status=pending_confirmation`로 전환하지 않음**

#### 3) 승인 UI: `App/frontend/src/components/Notification/NotificationDetailModal.tsx`
- `session.status === 'pending_confirmation'`일 때만 `FunctionCallCard`(pending UI)를 노출
- 실제 카드는 `useCardsForSession(session.id)`로 `EditCardStore`에서 읽음
- Apply 버튼 누르면 `batchConfirmSession(session.id, selections, { projectId, language: mainLanguage })`

#### 4) 치명적 문제(현재 AIEdit가 “독자 코드”가 된 근본 원인)
- `AIEditModal.tsx`에서 **`task.complete()`를 절대 호출하지 않음**
  - → 세션 status가 `running`에서 끝나지 않음(알림 stuck)
- `pending_confirmation`을 세팅하는 코드가 없음
  - → NotificationDetailModal의 승인 UI가 구조상 도달 불가
- function schema/handler mismatch(아래 1.5)로 **특정 함수는 apply 단계에서 실패**

---

### 1.3 translateObjects(Translation) 플로우(현재)

#### 1) 진입점: `App/frontend/src/components/TranslationModal.tsx`
- `handleStart`에서:
  1. `LLMTaskManager.startTask({ taskType:'translation', label:'Translation', retryContext })`
  2. 모달 닫음
  3. `TranslationService.translateBatch(objectsToTranslate, options)` 호출
  4. 성공 시 `task.complete()`

#### 2) 오케스트레이터: `App/frontend/src/services/translationService.ts`
- `translateObjects`/`translateBatch` 내부:
  1. `new LLMTask({ mode: TRANSLATION, promptContext, sessionId }, callbacks)`
  2. `onComplete`에서 function calls를 `ALL_TRANSLATION_FUNCTION_NAMES`로 필터링
  3. `applyTranslationFunctionCalls(...)`로 **즉시 auto‑apply** (`UnifiedApplicator.apply`)
  4. 성공/실패를 `llmTaskStore.setFunctionCallResults(sessionId, aggregated)`에 기록
- translation 함수 호출 이름은 `set_*_translation`, `patch_*_translation` 등 “translation 전용 툴”을 사용

#### 3) 문제(통합 관점)
- AIEdit와 달리 **translation은 자체 오케스트레이터(TranslationService) + 자체 필터/적용 로직**을 가짐
- 승인/검증/적용이 “TaskRuntime”에 모이지 않음 → 네가 말한 “validation 플로우를 두 번 구현” 문제가 발생
- `LLMTaskMode.CHAT_TRANSLATION`, `ChatTranslationPromptContext` 같은 **존재하지 않는 타입/모드 참조 버그**가 있음(이 구조가 흩어져있어서 생기는 전형적인 문제)
- “batch” 네이밍이 코드/주석에 박혀있음

---

### 1.4 다른 LLMTask 사용 컴포넌트(현재)

#### Agent: `App/frontend/src/agent/processors/AgentManager.ts`
- 내부에서 `new LLMTask(...)` 생성
- function calls 처리는 AgentManager 콜백(`onFunctionCalls`)로 위임
- 결과 적용/승인/카드 등은 agent 쪽 별도 로직(현 문서 범위에서는 구조만 기록)

#### Image Prompt: `App/frontend/src/components/ImageGeneration/UnifiedImagePromptModal.tsx`
- `LLMTaskManager.startTask(...)` + `new LLMTask(...)`
- onComplete에서 prompt를 파싱하고 `task.complete()` 호출

=> 결론: 같은 “LLMTask”를 쓰지만 **task 생성/종료/결과처리가 각각 다른 방식으로 구현**됨.

---

### 1.5 Function schema/handler mismatch(현재 코드의 구조적 결함)

#### SSoT로 주장되는 스키마: `App/frontend/src/functionCall/schemas/schemaRegistry.ts`
다음 함수들이 스키마에 존재:
- `create_chapter`
- `delete_chapter`
- `replace_chapter_outline`
- `patch_chapter_outline`

#### 실제 applicator handlers: `App/frontend/src/functionCall/applicator/handlers/*.ts`
실제 구현/등록은 outline‑prefixed만 존재:
- CRUD: `create_outline_chapter`, `delete_outline_chapter`만 구현(`CrudHandlers.ts`)
- REPLACE/PATCH: `replace_outline_chapter`, `patch_outline_chapter`만 구현
- 위 4개의 “non‑outline” 함수는 `ALL_HANDLERS`에 없어서 apply 시 `Unsupported function` 에러가 남

=> 즉, **스키마 검증은 통과해도 적용 단계에서 실패**하는 구조적 버그가 존재.

---

## 2) TO‑BE: “하나의 플로우”로 LLM Task를 통합하는 최종 구조

### 2.1 최종 목표(불변)
- **Task 생성 → 스트리밍 → 결과 파싱 → 툴콜 정규화/검증 → 승인(수동/자동) → 적용 → 결과 저장**  
  이 전체가 **단 하나의 Runtime 코드 경로**로만 흐르도록 만든다.
- UI(모달)는 “입력 수집 + start 호출”만 담당. 모달/패널이 사라져도 task는 계속 진행.
- `aiEdit` vs `translateObjects`는 실행 파이프라인을 **100% 공유**하고, 차이는 “파라미터”로만 표현한다:
  - `language` (main vs target)
  - `createNewVersion` (true vs false)
  - `confirmPolicy` (manual vs auto)

---

### 2.2 최종 Spec 정의 (인터페이스)

#### 1) `TaskKind`, `TaskSpecRegistry`
```ts
// App/frontend/src/llmTask/runtime/specRegistry.ts
export const TASK_SPECS = {
  aiEdit: aiEditSpec,
  translateObjects: translateObjectsSpec,
  agent: agentSpec,
  imagePrompt: imagePromptSpec,
  sceneImage: sceneImageSpec,
  agentTranslation: agentTranslationSpec,
} as const;

export type TaskKind = keyof typeof TASK_SPECS;

export type TaskInputOf<K extends TaskKind> =
  (typeof TASK_SPECS)[K] extends TaskSpec<infer TInput> ? TInput : never;
```

#### 2) `TaskEnv`
```ts
export type TaskEnv = {
  projectId: string;
  mainLanguage: string;
  nativeOutputMode: boolean;
  // 필요하면 settings snapshot을 통째로 넣어도 됨(단, 함수/클래스 금지)
};
```

#### 3) `TaskSpec<TInput>`
```ts
import type { ContentPart, FunctionCallMetadata } from '../llm/requestTypes';
import type { LLMTaskConfig, LLMTaskResult } from '../llm/types';
import type { ExecutionContext } from '../functionCall';

export type ConfirmPolicy = 'manual' | 'auto';

export type ToolPolicy = {
  confirm: ConfirmPolicy;
  allowFunction: (name: string) => boolean;
  executionContext: ExecutionContext & {
    handlerOptions: { createNewVersion: boolean; userRequest: string };
  };
};

export type ParsedLLMResult = {
  contentParts: ContentPart[];
  thinkingDetails?: any[];
  functionCalls: FunctionCallMetadata[];
};

export interface TaskSpec<TInput> {
  kind: TaskKind;

  label: (input: TInput, env: TaskEnv) => string;

  buildLLMConfig: (input: TInput, env: TaskEnv, sessionId: string) => Promise<LLMTaskConfig>;

  parseLLMResult: (input: TInput, env: TaskEnv, result: LLMTaskResult) => Promise<ParsedLLMResult>;

  toolPolicy: (input: TInput, env: TaskEnv) => ToolPolicy;
}
```

#### 4) `TaskRuntime` (단 하나의 실행 API)
```ts
export interface TaskRuntime {
  start<K extends TaskKind>(kind: K, input: TaskInputOf<K>, env: TaskEnv): { sessionId: string };
  cancel(sessionId: string): void;

  // manual confirm용: selection map (cardId -> apply?)
  confirm(sessionId: string, selections: Record<string, boolean>): Promise<void>;
  rejectAll(sessionId: string): void;

  // 모달 없이 retry
  retry(sessionId: string): { sessionId: string };
}
```

#### 5) `llmTaskStore` 세션 스키마(최종: EditCardStore 제거 후 “한 곳”으로 합침)
```ts
import type { ContentPart, FunctionCallMetadata, FunctionCallProgress } from '../llm/requestTypes';
import type { AggregatedFunctionCallResults } from '../llm/retry/types';
import type { ApplicationResult, FunctionCallFailureType } from '../functionCall';

export type TaskSessionStatus =
  | 'running'
  | 'pending_confirmation' // manual confirm 대기
  | 'applying'             // auto-apply 또는 confirm 이후 apply 진행중
  | 'success'
  | 'error'
  | 'cancelled';

export type ActionCardStatus =
  | 'validating'
  | 'pending'   // 유저가 apply/reject 선택해야 하는 상태
  | 'accepted'
  | 'rejected'
  | 'failed';

// NOTE:
// - 기존 UI(`components/functionCall/*`)는 `functionCall/types`의 `EditCard`를 입력으로 받는다.
// - 최종안에서 “카드 모델”은 새로 만들 필요 없이 `type ActionCard = EditCard`로 재사용하면
//   UI 수정량이 최소가 된다(단, 저장소만 llmTaskStore로 합치면 됨).
export type ActionCard = {
  id: string;               // tool_call_id
  functionName: string;
  args: Record<string, unknown>;

  // UI 표시용(기존 FunctionCallCard 컴포넌트가 필요로 하는 정보로 맞추면 됨)
  title: string;
  description: string;

  status: ActionCardStatus;
  failureType?: FunctionCallFailureType; // 'validation' | 'execution'
  reason?: string;
  result?: ApplicationResult;

  createdAt: number;
  updatedAt: number;
};

export type SessionActions = {
  // apply 시점에 필요한 스냅샷(= 모달이 없어도 적용 가능)
  policy: ToolPolicy;
  calls: FunctionCallMetadata[]; // parseLLMResult 결과 그대로 저장(또는 normalized 저장)

  cardsById: Record<string, ActionCard>;
  order: string[];
};

export type LLMTaskSessionState = {
  id: string;
  kind: TaskKind;
  input: unknown;      // TaskInputOf<kind> (store에는 직렬화 가능한 형태로 저장)
  env: TaskEnv;        // retry를 위한 최소 스냅샷

  status: TaskSessionStatus;
  label: string;

  contentParts: ContentPart[];
  functionCallProgress: FunctionCallProgress[];

  actions?: SessionActions;
  functionCallResults?: AggregatedFunctionCallResults;

  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

---

### 2.3 공통 실행 파이프라인(단일 구현) — TaskController + FunctionCallEngine

#### 1) 세션 생성
- `TaskRuntime.start(kind, input, env)`:
  - sessionId 생성
  - `llmTaskStore.sessions[sessionId]` 초기화:
    - `kind`, `input`, `envSnapshot`(필요 최소), `status: running`, `label`
  - `TaskController` 생성/등록 후 `run()` fire‑and‑forget

#### 2) 스트리밍
- `TaskController`가 `LLMTask`를 감싸거나, LLMTask의 기능을 흡수한 Runner를 사용한다.
- **핵심 규칙:** store 업데이트는 Controller가 한다. (`LLMTask.ts`에서 store mutate 제거)
- 스트리밍 중 업데이트:
  - `llmTaskStore.setContentParts(sessionId, parts)`
  - `llmTaskStore.setFunctionCallProgress(sessionId, progress)`

#### 3) 종료/결과 파싱
- `spec.parseLLMResult(...)`로:
  - nativeOutputMode면 content 텍스트를 `convertNativeOutputToFunctionCalls`로 변환
  - 아니면 LLMTaskResult.functionCalls 사용

#### 4) 함수 호출 처리(공통 엔진)
- `FunctionCallEngine.handle(sessionId, functionCalls, policy)`:
  - normalize → schema validate → async validators(validate.ts) 실행
  - cards 생성 + store 저장
  - policy.confirm이 `auto`면 즉시 apply
  - `manual`이면 session.status를 `pending_confirmation`으로 바꾸고 종료(유저 입력 대기)

#### 5) 적용(Apply)
- `FunctionCallEngine.applySelected(sessionId, selections)`:
  - apply 직전 re‑validate(데이터가 변했을 수 있으므로)
  - `UnifiedApplicator.apply(rawCall, executionContext)` 호출
  - 결과를 card + `llmTaskStore.functionCallResults`에 반영
  - 완료 시 session.status를 `success|error`로 마감

#### 6) Progress(진행률) 저장 규칙(translation만 “batch”처럼 취급되던 문제 제거)
- 모든 Task는 기본적으로 “여러 오퍼레이션”을 포함할 수 있으므로 progress는 **공통 모델**로 관리한다.
- `llmTaskStore.sessions[sessionId].progress = { current, total, currentItemLabel? }`
  - `aiEdit`:
    - `total = functionCalls.length` (또는 cards.length)
    - `current = accepted + rejected + failed`
  - `translateObjects`:
    - `total = input.objects.length`
    - `current = 번역 적용이 끝난 objectId의 unique count`
    - `currentItemLabel = \`{objectType}:{name}\`` 같은 형태로 옵션 제공
- streaming 중 “tool_calls 생성 진행”은 `functionCallProgress`로 별도 표기하고,
  apply 진행률은 `progress`로 별도 표기한다(둘을 섞지 않음).

---

### 2.4 `aiEdit` vs `translateObjects`: “공통 기능 100% 공유”의 **정확한 의미**

#### 공통(완전히 동일한 코드 경로로 실행되는 것)
- Task 생성/세션 관리(`TaskRuntime`)
- 스트리밍 저장(`TaskController`)
- functionCalls 정규화/검증/카드화(`FunctionCallEngine`)
- 승인 UI/알림 UI(세션에서 cards를 읽는 방식)
- 적용/에러처리/결과 저장(`FunctionCallEngine` + `UnifiedApplicator`)
- Retry(세션에 저장된 kind+input으로)

#### 차이(오직 Spec 파라미터로만 표현)
| 항목 | aiEdit | translateObjects |
|---|---|---|
| executionContext.language | `env.mainLanguage` | `input.targetLanguage` |
| handlerOptions.createNewVersion | `true` | `false` |
| handlerOptions.userRequest | 사용자 입력(`input.userRequest`) | `'AI Translation'` 고정 |
| confirmPolicy | `manual` | `auto` |
| allowFunction | CRUD+Replace+Patch (스코프에 따라 제한) | Replace/Patch만 허용 |

=> 즉, “두 task가 다른 코드를 가진다”가 아니라, **같은 엔진에 다른 설정만 주입**한다.

---

## 3) Canonical Function/Tool Spec (SSoT) — 이름/스키마/핸들러 정리(최종)

### 3.1 translateObjects에서 “translation 전용 tool name” 제거
최종안: translateObjects는 아래 함수만 호출한다(= aiEdit와 동일 툴):
- `replace_basic_info`, `patch_basic_info`
- `replace_story_object`, `patch_story_object`
- `replace_outline_act`, `patch_outline_act`
- `replace_outline_chapter`, `patch_outline_chapter`
- `replace_manuscript`, `patch_manuscript`

삭제 대상(전부 제거):
- `set_*_translation`, `patch_*_translation`
- `TRANSLATION_HANDLERS` wrapper layer (`functionCall/applicator/handlers/index.ts`)
- `llm/schemas/translationFunctions.ts` (PromptManager/TranslationService용 중복 스키마)

### 3.2 schemaRegistry ↔ handlers mismatch 해결(최종)
`schemaRegistry.ts`에서 아래 4개는 **존재 자체가 중복/혼란**이고, 현재 핸들러도 없으므로 제거한다:
- `create_chapter` → `create_outline_chapter`로 통일
- `delete_chapter` → `delete_outline_chapter`로 통일
- `replace_chapter_outline` → `replace_outline_chapter`로 통일
- `patch_chapter_outline` → `patch_outline_chapter`로 통일

그리고 function sets도 정리한다:
- `STORY_OBJECT_EDIT_FUNCTIONS` / `AGENT_FUNCTIONS`에서 위 4개 제거, outline‑prefixed로 교체

---

## 4) TO‑BE 코드 구조(폴더 설계)

> 아래는 “최종적으로 남겨둘 파일/폴더” 기준.

```
App/frontend/src/
  llmTask/
    runtime/
      TaskRuntime.ts
      TaskController.ts
      specRegistry.ts
      TaskSpec.ts
    engine/
      FunctionCallEngine.ts
      functionCallPlan.ts            // normalize/validate/cardify (pure)
    specs/
      aiEditSpec.ts
      translateObjectsSpec.ts
      agentSpec.ts                   // (LLMTask 기반 agent도 동일 runtime에 얹을 때)
      agentTranslationSpec.ts        // (메시지 번역)
      imagePromptSpec.ts             // (image prompt)
      sceneImageSpec.ts              // (scene image prompt)
```

### 4.1 `TaskController` 임시 코드(스켈레톤)
```ts
export class TaskController<TInput> {
  constructor(
    private spec: TaskSpec<TInput>,
    private sessionId: string,
    private input: TInput,
    private env: TaskEnv,
    private functionCallEngine: FunctionCallEngine
  ) {}

  run(): void {
    void this.runInternal();
  }

  private async runInternal(): Promise<void> {
    // 1) llm config
    const cfg = await this.spec.buildLLMConfig(this.input, this.env, this.sessionId);

    // 2) run LLMTask (callbacks must write to llmTaskStore)
    const task = new LLMTask(cfg, {
      onUpdate: (parts) => llmTaskStore.setContentParts(this.sessionId, parts),
      onFunctionProgress: (p) => llmTaskStore.setFunctionCallProgress(this.sessionId, p),
      onError: (e) => llmTaskStore.setTaskError(this.sessionId, e.message),
      onComplete: async (result) => {
        const parsed = await this.spec.parseLLMResult(this.input, this.env, result);
        const policy = this.spec.toolPolicy(this.input, this.env);
        await this.functionCallEngine.handle(this.sessionId, parsed.functionCalls, policy);
      },
    });

    await task.run();
  }
}
```

### 4.2 `FunctionCallEngine` 임시 코드(스켈레톤)
```ts
export class FunctionCallEngine {
  async handle(sessionId: string, calls: FunctionCallMetadata[], policy: ToolPolicy): Promise<void> {
    // normalize + filter(allowFunction) + validate(schema+async)
    // create cards in llmTaskStore
    // if manual: set session.status='pending_confirmation'
    // if auto: apply all immediately
  }

  async applySelected(sessionId: string, selections: Record<string, boolean>): Promise<void> {
    // revalidate + apply via UnifiedApplicator + write results + finalize session
  }
}
```

---

## 5) “어디를 고쳐야 하는지” — 변경 맵(파일 단위, 정확히)

> 아래 리스트는 “최종 상태를 만들기 위해” 실제로 손대야 하는 파일들이다.  
> (네가 지적한 “AI Edit은 별도 코드라 validation 플로우를 재구현해야 했다”를 없애는 핵심은 **TranslationService/AIEditModal 오케스트레이션을 제거하고 TaskRuntime으로 치환**하는 것이다.)

### 5.1 삭제(legacy 전면 제거)
- `App/frontend/src/services/translationService.ts`
  - translateObjects/translateBatch/translateChatMessage 등 LLM 오케스트레이션 제거
  - translateObjects는 `translateObjectsSpec` + `TaskRuntime`으로 대체
- `App/frontend/src/llm/schemas/translationFunctions.ts`
  - translation 전용 function schemas/이름 세트 제거(SSoT를 schemaRegistry로 통일)
- `App/frontend/src/functionCall/editCards/EditCardStore.ts`
  - 카드/승인 상태를 llmTaskStore로 합치므로 삭제
- `App/frontend/src/functionCall/hooks/useFunctionCallHandlers.ts`
  - “오케스트레이션” 역할은 FunctionCallEngine으로 이동
  - UI 훅이 필요하면 llmTaskStore selectors로 대체
- `App/frontend/src/functionCall/applicator/handlers/index.ts` 내 `TRANSLATION_HANDLERS`
  - translation wrapper function name layer 제거
- `App/frontend/src/llm/LLMTaskManager.ts`
  - 세션 생성/완료 핸들은 TaskRuntime이 담당

### 5.2 수정(핵심: aiEdit/translateObjects가 같은 파이프라인 사용하도록)

- `App/frontend/src/components/AIEditModal.tsx`
  - `LLMTaskManager.startTask` / `new LLMTask` / `processFunctionCallsForSession` 삭제
  - 대신:
    - input 구성(`aiEdit` input)
    - `TaskRuntime.start('aiEdit', input, env)` 호출
    - 모달 닫기

- `App/frontend/src/components/TranslationModal.tsx`
  - `TranslationService.translateBatch` 삭제
  - 대신:
    - input 구성(`translateObjects` input)
    - `TaskRuntime.start('translateObjects', input, env)` 호출
  - UI 텍스트/주석에서 “batch” 제거

- `App/frontend/src/components/Notification/NotificationDetailModal.tsx`
  - `EditCardStore` 의존 제거
  - session에서 cards를 직접 렌더(= llmTaskStore.sessions[sessionId].actions)
  - Apply 버튼 → `TaskRuntime.confirm(sessionId, selections)` 호출

- `App/frontend/src/components/Notification/NotificationItem.tsx`
  - `pending_confirmation` 상태를 정상 표시(아이콘/메시지)

- `App/frontend/src/components/Notification/NotificationPanel.tsx`
  - retry를 “모달 import/props 재구성” 방식에서 제거
  - `TaskRuntime.retry(sessionId)`로 교체 → Notification이 모달에 의존하지 않게 됨

- `App/frontend/src/store/llmTaskStore.ts`
  - session에 `kind`, `input`, `actions(cards/results)`, `status(applying 등)` 추가
  - AbortController unregister lifecycle를 추가(작업 완료 시 제거)

- `App/frontend/src/llm/LLMTask.ts`
  - store 직접 mutate 제거(콜백만 호출)
  - abort controller unregister를 완료/에러/취소에 맞춰 수행

- `App/frontend/src/llm/PromptManager.ts`
  - translation 함수 스키마 import 제거
  - 함수 스키마는 TaskSpec/ToolPolicy에서 제공(= “모드가 함수 결정” 구조 제거)

- `App/frontend/src/functionCall/schemas/schemaRegistry.ts`
  - translation 전용 함수들 제거
  - mismatch 4종 제거/정리(3.2)
  - function sets(STORY_OBJECT_EDIT_FUNCTIONS/AGENT_FUNCTIONS)도 정리

### 5.3 새로 추가(통합 런타임)
- `App/frontend/src/llmTask/runtime/TaskRuntime.ts`
- `App/frontend/src/llmTask/runtime/TaskController.ts`
- `App/frontend/src/llmTask/runtime/specRegistry.ts`
- `App/frontend/src/llmTask/runtime/TaskSpec.ts`
- `App/frontend/src/llmTask/engine/FunctionCallEngine.ts`
- `App/frontend/src/llmTask/specs/aiEditSpec.ts`
- `App/frontend/src/llmTask/specs/translateObjectsSpec.ts`

### 5.4 프롬프트(템플릿) 변경(필수)
- Translation 프롬프트는 이제 `set_*_translation`을 쓰면 안 된다.
- translateObjects 시스템/유저 프롬프트 템플릿에서:
  - “Allowed tools: replace_*/patch_* only”를 명시
  - “target language = input.targetLanguage”를 명시

### 5.5 백엔드 프롬프트/프래그먼트(파일/DB) 정리(필수)
현재 백엔드에서 프롬프트/프래그먼트는 **파일로 존재하지만 DB default seed에 일부만 들어가서** 템플릿 렌더링 시 `[Fragment Error: Not found - ...]`가 발생할 수 있다.

#### 5.5.1 반드시 수정할 템플릿(Translation)
- `App/backend/prompts/templates/translation/object/systemPrompt.md`
  - `{{prompt "translation/functions"}}` 제거(translation 전용 tool 설명 제거)
  - 대신 공통 editOperations 프래그먼트 재사용:
    - `{{prompt "common/editOperations/storyObject" allowCrud=false}}`
    - `{{prompt "common/editOperations/outline" allowCrud=false}}`
    - `{{prompt "common/editOperations/manuscript"}}`
  - “set_* vs patch_*” 문구를 “replace_* vs patch_*”로 교체
- `App/backend/prompts/templates/translation/object/userPrompt.md`
  - “set_* (full rewrite)” → “replace_* (full rewrite)”로 교체

#### 5.5.2 반드시 수정할 프래그먼트(공통)
- `App/backend/prompts/default_fragments/common/editOperations/storyObject.md`
  - CRUD 섹션을 `{{#if allowCrud}} ... {{/if}}`로 감싸서 translation에서는 숨기기
- `App/backend/prompts/default_fragments/common/editOperations/outline.md`
  - CRUD 섹션을 `{{#if allowCrud}} ... {{/if}}`로 감싸서 translation에서는 숨기기
- `App/backend/prompts/default_fragments/common/nativeOutput/storyObject.md`
  - 현재 내용이 `create_chapter/delete_chapter/replace_chapter_outline/patch_chapter_outline`를 포함 → 최종 canonical에 맞게 교체:
    - `create_outline_chapter`
    - `delete_outline_chapter`
    - `replace_outline_chapter`
    - `patch_outline_chapter`
  - (선택) 이 파일도 `allowCrud` 플래그를 받아 CRUD 예시를 숨길 수 있게 정리

#### 5.5.3 삭제(또는 내용 통합)할 translation 전용 프래그먼트
최종안에서는 translation도 `replace_*/patch_*`만 사용하므로, 아래 파일은 **중복이자 혼란의 원인**이다.
- `App/backend/prompts/default_fragments/translation/functions.md`
- `App/backend/prompts/default_fragments/translation/nativeOutput.md`

#### 5.5.4 “시스템 default seed”를 하나로 합치기(프래그먼트 누락 방지)
- `App/backend/prompts/__init__.py`
  - `DEFAULT_FRAGMENTS = { ... }` 수동 리스트를 제거하고,
    `default_fragments/**/*.md`를 **자동 스캔해서 전부 seed**하도록 변경한다.
  - 키는 파일 상대경로(확장자 제거) 그대로 사용: 예) `translation/functions`, `agent/storyStructure`

---

## 6) translateObjectsSpec / aiEditSpec “차이만 남기는” 예시(임시 코드)

### 6.1 translateObjectsSpec(핵심 포인트만)
```ts
export type TranslateObjectsInput = {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  objects: Array<{ objectType: string; objectId: string; sourceData: Record<string, any>; versionNumber?: number }>;
  contextObjectIds?: string[];
  contextData?: Record<string, any>;
};

const ALLOW_TRANSLATE_UPDATE_ONLY = (name: string) =>
  name.startsWith('replace_') || name.startsWith('patch_');

export const translateObjectsSpec: TaskSpec<TranslateObjectsInput> = {
  kind: 'translateObjects',
  label: (input) => `Translation: ${input.sourceLanguage} -> ${input.targetLanguage} (${input.objects.length})`,
  buildLLMConfig: async (input, env, sessionId) => ({
    mode: LLMTaskMode.TRANSLATION,
    projectId: env.projectId,
    sessionId,
    abortControllerRef: { current: null } as any,
    promptContext: {
      userInput: input.userInput || 'Translate the following objects.',
      projectId: env.projectId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      objectCount: input.objects.length,
      objectsArray: input.objects.map(o => ({ objectType: o.objectType, objectId: o.objectId, ...o.sourceData })),
      contextObjectIds: input.contextObjectIds,
      contextData: input.contextData,
      isNativeOutput: env.nativeOutputMode,
      outputLanguage: input.targetLanguage,
    },
  }),
  parseLLMResult: async (_input, env, result) => {
    if (env.nativeOutputMode) {
      const text = result.contentParts.filter(p => p.type === 'content').map(p => p.text).join('');
      return { contentParts: result.contentParts, functionCalls: convertNativeOutputToFunctionCalls(text), thinkingDetails: result.thinkingDetails };
    }
    return { contentParts: result.contentParts, functionCalls: result.functionCalls, thinkingDetails: result.thinkingDetails };
  },
  toolPolicy: (input, env) => ({
    confirm: 'auto',
    allowFunction: ALLOW_TRANSLATE_UPDATE_ONLY,
    executionContext: {
      projectId: env.projectId,
      language: input.targetLanguage,
      handlerOptions: { createNewVersion: false, userRequest: 'AI Translation' },
    },
  }),
};
```

### 6.2 aiEditSpec(핵심 포인트만)
```ts
export type AiEditInput = {
  projectId: string;
  category: string;
  targetId?: string;
  userRequest: string;
  contextIds?: string[];
};

export const aiEditSpec: TaskSpec<AiEditInput> = {
  kind: 'aiEdit',
  label: (input) => `AI Edit: ${input.category}${input.targetId ? ` (${input.targetId})` : ''}`,
  buildLLMConfig: async (input, env, sessionId) => ({
    mode: input.category === 'manuscript'
      ? LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT
      : LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT,
    projectId: env.projectId,
    sessionId,
    abortControllerRef: { current: null } as any,
    promptContext: /* 기존 AIEditModal의 promptContext 빌드를 여기로 이동 */,
  }),
  parseLLMResult: async (_input, env, result) => {
    if (env.nativeOutputMode) {
      const text = result.contentParts.filter(p => p.type === 'content').map(p => p.text).join('');
      return { contentParts: result.contentParts, functionCalls: convertNativeOutputToFunctionCalls(text), thinkingDetails: result.thinkingDetails };
    }
    return { contentParts: result.contentParts, functionCalls: result.functionCalls, thinkingDetails: result.thinkingDetails };
  },
  toolPolicy: (_input, env) => ({
    confirm: 'manual',
    allowFunction: (name) => true, // 실제로는 카테고리별로 제한
    executionContext: {
      projectId: env.projectId,
      language: env.mainLanguage,
      handlerOptions: { createNewVersion: true, userRequest: 'AI Edit' },
    },
  }),
};
```

---

## 7) 체크포인트: 네가 질문한 포인트에 대한 결론(요약)

- “Input” = task 시작에 필요한 **순수 데이터**(Retry 가능한 형태). sessionId/abort/ui callback은 포함하지 않는다.
- `TaskKind`를 spec에 둔 이유 = **registry key + 세션 영속(=모달 독립) + 디버깅/Retry**를 위해 필요.
- `aiEdit` ↔ `translateObjects` 공통화는 “코드 중복 제거” 수준이 아니라,
  - `AIEditModal.tsx`, `TranslationModal.tsx`, `translationService.ts` 같은 **오케스트레이터를 삭제**
  - `TaskRuntime/TaskController/FunctionCallEngine`이라는 **단 하나의 파이프라인으로 치환**
  - 차이는 Spec 파라미터(언어/버전/승인정책)로만 남기는 것이다.
- 왜 translation만 batch라고 불렸나 = 과거 네이밍 잔재. 최종안에서는 batch 개념 삭제하고 `translateObjects`로 통일.
