# Raw Output Mode 도입 계획 (Native Output 용어 분리)

작성일: 2026-01-07

## 1) 배경 / 문제

현재 코드/프롬프트/설정에서 `native output mode`라는 용어가 아래 2가지를 **동시에** 의미합니다.

1. **태그 기반 함수호출(= “native function call”)**
   - LLM이 `<function_calls><function_call>{...}</function_call>...</function_calls>` 형태로 텍스트를 출력
   - 백엔드가 스트리밍 중 태그를 파싱해서 `tool_calls` delta로 변환
2. **콘텐츠(raw text) 직접 사용(= “raw output”)**
   - LLM이 텍스트를 출력하면 그대로 content로 사용 (함수 호출/파싱 없음)

이 혼선 때문에 “native output mode” 토글/변수 이름만으로는 실제 동작을 예측하기 어렵습니다.

## 2) 목표

- “콘텐츠를 그대로 사용하는 방식”을 **Raw Output Mode**로 명확히 분리한다.
- “태그 기반 함수호출(파싱 후 tool_calls로 변환)”을 **Native Function Call Mode**로 명확히 분리한다.
- **Object Image Prompt는 설정과 무관하게 항상 Raw Output만 사용**하도록 강제한다.

## 2.1) 이전 분류 상태 (As-Is)

- 단일 토글 `nativeOutputMode`에 의미가 혼재되어 있음
  - Edit/Translation: `<function_calls>` 태그 기반 출력 → 서버 파싱 → `tool_calls`로 변환(`native_function_call` 성격)
  - Image Prompt (object): 토글에 따라 “raw text 사용” 또는 “tool call 사용”이 갈림(혼재)
  - Image Prompt (scene/cover): 설정과 무관하게 raw text 사용
  - Agent Translation: 설정과 무관하게 raw text 사용
- 템플릿 변수 `config.isNativeOutputMode`도 task에 따라 “태그 기반 함수호출” 또는 “그냥 텍스트 출력” 의미로 번갈아 사용됨

## 2.2) 이후 분류 상태 (To-Be)

- OutputMode를 명시적으로 3분리
  - `tool_call`: 요청에 functions/tools 포함 + provider-native `tool_calls` 사용
  - `native_function_call`: 요청에 functions/tools **절대 미포함(omit 보장)** + `<function_calls>` 출력 + 서버 파싱으로 `tool_calls` 변환
  - `raw_output`: 요청에 functions/tools **절대 미포함(omit 보장)** + 파싱/변환 없이 content(text) 그대로 사용
- Task 매핑 원칙
  - Image Prompt (object/scene/cover): **항상 `raw_output`**(설정 무관)
  - Agent Translation: `raw_output`
  - Edit Assistant / Translation: `tool_call` 또는 `native_function_call` 중 선택(필요 시 UI로 노출)

## 3) 용어 정의 (To-Be)

- `tool_call` 모드
  - functions/tool schemas를 요청에 포함
  - provider의 “진짜 tool calling” 응답(`tool_calls`)을 사용

- `native_function_call` 모드
  - 요청에는 functions/tool schemas가 **절대 포함되지 않음(omit 보장)**
  - LLM 출력은 `<function_calls>` 태그 기반
  - 백엔드 스트리밍 파서가 태그를 제거하고 `tool_calls` delta를 방출
  - API 요청 플래그: `native_function_call: true`

- `raw_output` 모드
  - 요청에는 functions/tool schemas가 **절대 포함되지 않음(omit 보장)**
  - `native_function_call`도 **false**
  - 결과는 content(text)를 그대로 사용 (추가 파싱/변환 없음)

## 4) 현재 구현 요약 (As-Is)

### Frontend
- 설정: `settings.nativeOutputMode: boolean`
  - `App/frontend/src/store/settingsStore.ts`
  - `App/frontend/src/components/SettingsModal/AdvancedPanel.tsx`
- Prompt 템플릿 변수: `config.isNativeOutputMode`
  - `App/frontend/src/llm/PromptManager.ts`에서 `context.isNativeOutput`를 `isNativeOutputMode`에 그대로 매핑
- `native_function_call` 요청 플래그는 일부 모드에서만 켜짐
  - `App/frontend/src/llm/LLMTask.ts`:
    - `EDIT_ASSISTANT_*`, `TRANSLATION` + `context.isNativeOutput===true` → `native_function_call=true`
    - 이미지 프롬프트/에이전트 번역은 raw만 쓰지만 `native_function_call`은 사용하지 않음
- 이미지 프롬프트:
  - Cover/Scene: 이미 raw 강제 (`isNativeOutput: true`)
  - Object: `nativeOutputMode` 설정에 따라 raw 또는 함수호출 모드가 섞여 있음
    - `App/frontend/src/llmTask/specs/imagePromptSpec.ts`

### Backend
- `native_function_call=true`일 때 `<function_calls>`를 파싱하여 `tool_calls`로 변환
  - `App/backend/providers/native_function_calls_parser.py`

## 5) 요구사항 반영 (추가)

- **Object Image Prompt도 raw 강제**
  - “raw output mode”는 설정과 무관하게 Image Prompt 전 범위(cover/scene/object)에서 항상 사용

## 6) 변경 설계(권장)

### 6.1 Frontend: OutputMode 도입(명시적 타입)

- `OutputMode = 'tool_call' | 'native_function_call' | 'raw_output'`
- `PromptContext`(또는 `LLMTaskConfig`)에 `outputMode`를 추가
- 템플릿 스키마(`TemplateData.config`)에도 `outputMode`(또는 `isRawOutputMode`/`isNativeFunctionCallMode`)를 추가
- 기존 `isNativeOutput`/`isNativeOutputMode`는 **이행 기간 동안** 호환 필드로 유지하고 점진 제거

### 6.2 Image Prompt: 항상 raw_output 강제

- `OBJECT_IMAGE_PROMPT`, `SCENE_IMAGE_PROMPT`, `COVER_IMAGE_PROMPT`의 `promptContext.outputMode = 'raw_output'`로 통일
- `PromptManager.getFunctionsForMode()`에서 imagePrompt 관련 함수 스키마 제공 경로는 제거(또는 항상 undefined)
- 프롬프트 템플릿도 imagePrompt 계열은 “항상 텍스트만 출력”으로 단순화 가능

### 6.3 Edit/Translation: native_function_call vs tool_call 분리

- Edit/Translation은 사용자가 선택한 “함수호출 방식”에 따라:
  - `tool_call` (진짜 tool calling)
  - `native_function_call` (태그 기반 + 백엔드 파싱)
  - (옵션) `raw_output`까지 노출할지 여부는 결정 필요

## 7) 구현 단계 계획(순서)

1. **타입/데이터 모델 추가**
   - Frontend: `OutputMode` 타입 추가 + 관련 컨텍스트/템플릿 데이터에 포함
   - Backend: 당장은 API 변경 없이도 가능(= raw는 flags 미사용). 다만 장기적으로는 `output_mode` enum 도입 고려

2. **Image Prompt 강제 raw 전환**
   - `App/frontend/src/llmTask/specs/imagePromptSpec.ts`에서 object도 raw 강제
   - UI에서 “function call mode”로 처리하던 fallback 경로는 제거/비활성화 검토

3. **LLMTask 스트리밍 플래그 결정 로직 정리**
   - `native_function_call` 플래그는 `outputMode === 'native_function_call'`일 때만 true
   - `tool_call` 모드일 때만 functions/tool schemas를 포함

4. **프롬프트 템플릿 변수 정리**
   - `config.isNativeOutputMode`의 의미를 “native_function_call인지 여부”로 축소하거나
   - `config.outputMode` 중심으로 전환하고 기존 변수는 호환용으로 유지 후 제거

5. **설정/UI 정리**
   - 현재 `nativeOutputMode` 단일 토글은 의미가 모호하므로 아래 중 1개 선택:
     - (A) “Native Function Call Mode(태그 파싱)” 토글로 이름/설명 변경 + Image Prompt엔 영향 없음
     - (B) dropdown으로 `tool_call` / `native_function_call` / `raw_output`(노출 범위는 결정 필요)
   - (B) 선택 시: 백엔드 settings schema + DB migration 필요

## 8) 검증(수동 테스트 체크리스트)

- Image Prompt (object/scene/cover)
  - 설정 ON/OFF 무관하게 항상 content(text)로 프롬프트가 채워짐
  - tool_calls/function_calls 관련 UI/상태가 개입되지 않음
- Edit Assistant / Translation
  - `tool_call` 모드: provider tool_calls로 정상 적용
  - `native_function_call` 모드: `<function_calls>`가 화면에 노출되지 않고 tool_calls로 변환되어 정상 적용
- Regression
  - Agent 기능(대화/툴콜) 동작 변화 없음
  - 스트리밍 종료([DONE]) 처리/에러 처리 변화 없음

## 9) 결정이 필요한 사항

- `nativeOutputMode`(boolean)를 유지하면서 의미만 재정의할지, 설정 자체를 `outputMode`(enum)로 올릴지
- Edit/Translation에도 `raw_output`를 사용자에게 노출할지(일반적으로는 비권장: 적용/검증이 어려움)
