# Prompt Pack Export/Import 설계 계획서

## 1) 목표

- **설정(Settings)에서 편집한 프롬프트/템플릿을 파일로 Export** 해서 로컬에 여러 세트를 보관한다.
- 필요 시 **Import로 한 번에 적용**해서 “프롬프트 세트(프롬프트 팩/프리셋)”를 쉽게 교체한다.
- 프롬프트가 참조하는 **Fragments/Variables까지 함께 관리**해서, 세트 간 전환 시 템플릿 깨짐을 최소화한다.

> 본 계획서는 “여러 개의 프롬프트 세트를 파일로 관리”하는 것을 1차 목표로 하며, DB 안에 여러 세트를 저장/스위칭하는 “프로필 기능”은 2차 확장으로 둔다.

---

## 2) 현재 구조 요약(현 상태)

### 2.1 Prompt(프롬프트)

- **Backend 저장소**: `PromptVersion` (테이블: `prompt_versions`)
  - key: `(user_id, function_type, prompt_category, prompt_name)` + `is_active`
  - 버전 관리(증분 `version_number`), 현재 활성 버전만 렌더링에 사용
- **Backend API**: `App/backend/routes/prompt_routes.py`
  - `GET /api/v1/prompts/{function_type}/{prompt_category}` (name 없는 프롬프트)
  - `GET /api/v1/prompts/{function_type}/{prompt_category}/{prompt_name}` (name 있는 프롬프트)
  - `POST .../save`, `GET .../versions`, `POST .../restore`
- **Frontend 편집 UI**: `App/frontend/src/components/SettingsModal/PromptsTemplatesPanel.tsx`
  - 프롬프트 목록은 `App/frontend/src/components/SettingsModal/promptTree.tsx`의 `PROMPT_TREE` 기반
  - 저장/로드는 `App/frontend/src/api/promptService.ts` 사용
  - 캐시는 `App/frontend/src/store/settingsStore.ts`의 `promptCache`에 저장

### 2.2 Fragment(프롬프트 조각)

- **Backend 저장소**: `PromptFragment` (테이블: `prompt_fragments`)
  - key: `(user_id, folder_path, fragment_name)` + `is_active`
  - 버전 관리 및 이동/삭제 기능 존재
- **Backend API**: `App/backend/routes/fragment_routes.py`
  - `GET /api/v1/fragments/all`(content 포함), `GET /tree`, `POST /save`, `POST /move`, `DELETE`, `POST /restore`
- **Frontend 사용처**
  - 템플릿 렌더링에서 `{{prompt "path"}}` 형태로 참조(간단한 검증은 `/fragments/validate`)
  - 렌더링 직전 `PromptManager.ensureFragmentsLoaded()`가 `getAllFragmentsWithContent()`로 로드

### 2.3 Variable(템플릿 변수)

- **Backend 저장소**: `PromptVariable` (테이블: `prompt_variables`)
  - key: `(user_id, name)` (Unique)
  - `var_type`은 생성 후 변경 불가(현재 API/서비스 구현상)
- **Backend API**: `App/backend/routes/variable_routes.py`
  - `GET /api/v1/variables`, `POST /api/v1/variables`, `PATCH /by-id/{id}/value`, `PUT /by-id/{id}`, `PUT /reorder`
- **Frontend 사용처**
  - 템플릿 렌더링 스키마에서 `{{variables.someName}}`로 사용
  - 상태는 `App/frontend/src/store/variableStore.ts`에서 관리

---

## 3) Export/Import에서 다뤄야 하는 범위(권장)

최소 범위(MVP):
- **Prompts(활성 버전 content)**
- **Fragments(활성 버전 content + description)**
- **Variables(정의 + 값 + 순서)**

선택 범위(옵션):
- “버전 히스토리까지 포함” (파일 크기/복잡도 증가) → 2차
- “시스템 디폴트로 초기화” 기능(Import 전에 리셋) → 2차

---

## 4) Export/Import 파일 포맷(권장안)

### 4.1 단일 JSON 파일(1차 권장)

브라우저에서 다운로드/업로드가 가장 단순하고, 백엔드/프론트 모두 구현 비용이 낮다.

**파일 예시(스키마 v1)**

```json
{
  "schema_version": 1,
  "meta": {
    "app": "Novel Buds",
    "exported_at": "2026-01-17T00:00:00Z",
    "name": "my-pack",
    "description": "Korean-first, concise prose"
  },
  "prompts": [
    {
      "function_type": "agent",
      "prompt_category": "systemPrompt",
      "prompt_name": "storyObject",
      "content": "..."
    }
  ],
  "fragments": [
    {
      "folder_path": "common",
      "fragment_name": "tone",
      "content": "...",
      "description": "..."
    }
  ],
  "variables": [
    {
      "name": "writingStyle",
      "var_type": "string",
      "value": "noir",
      "description": "overall style",
      "select_options": null,
      "number_options": null,
      "display_order": 0
    }
  ]
}
```

**정규화 규칙(중요)**
- `prompt_name`가 없는 프롬프트는 `null`로 저장(또는 필드 생략)하되, Import 시 동일 규칙을 적용
- `folder_path`는 `/`를 구분자로 사용(프론트/백 공통)
- 저장은 항상 UTF-8
- `schema_version`는 Import 시 호환성 판단 기준(필수)

### 4.2 (옵션) ZIP + 폴더 구조(2차)

개발자가 git에서 diff/merge 하기 쉬운 형태가 필요하면, JSON을 ZIP로 패키징하여 아래 구조로 저장할 수 있다.

```
prompt-pack/
  manifest.json
  prompts/
    agent/storyObject/systemPrompt.md
    agent/storyObject/userPrompt.md
    ...
  fragments/
    common/tone.md
    translation/functions.md
  variables.json
```

> 1차는 JSON으로 먼저 구현하고, 추후 필요 시 “ZIP로 내보내기/가져오기”만 추가하면 된다(내부 데이터 모델은 동일).

---

## 5) Import 정책(충돌/적용 방식)

### 5.1 적용 모드

- **merge(기본 권장)**: 파일에 들어있는 항목만 upsert하고, 나머지는 건드리지 않음(데이터 손실 위험 낮음)
- **replace(선택)**: 파일에 들어있는 항목을 upsert + (옵션) 파일에 없는 항목 삭제/비활성화
  - UX상 “정말 삭제할지” 명확한 경고/요약이 필요

### 5.2 Prompt 적용 규칙

- key: `(function_type, prompt_category, prompt_name)`
- Import 시:
  - 기존과 동일 key가 있으면 **새 버전으로 저장(save_new_version)** 후 active로 설정
  - note에 `"Imported: <packName>"` 같은 메타를 추가(버전 히스토리에 흔적 남김)

### 5.3 Fragment 적용 규칙

- key: `(folder_path, fragment_name)`
- Import 시:
  - 동일 key가 있으면 **새 버전으로 저장** 후 active로 설정
  - description은 파일 값 우선(없으면 기존 유지)

### 5.4 Variable 적용 규칙(중요 제약)

- key: `name` (Unique)
- 현재 구현상 `var_type` 변경이 어렵다(업데이트 API가 타입 변경을 지원하지 않음).
- Import 정책 권장:
  - 동일 name이 있고 `var_type`도 동일 → 정의/값/순서 업데이트
  - 동일 name이 있으나 `var_type`이 다름
    - merge: **스킵 + 경고**
    - replace: **기존 삭제 후 새로 생성**(사용자 확인 필수)

---

## 6) 코드 구현 방안(추천 아키텍처)

### 옵션 A) Backend에 “Prompt Pack” 벌크 API 추가 (권장)

장점:
- 프론트에서 N개 요청을 나눠 보내지 않아도 됨(성능/단순성)
- Import를 **트랜잭션으로 원자적 처리**(중간 실패 시 롤백 가능)
- 서버에서 스키마 검증/경고 생성 가능

구현 개요:

1) Backend: 스키마/서비스/라우트 추가
- `App/backend/schemas/prompt_packs.py` (신규)
  - `PromptPack`, `PromptPackPromptItem`, `PromptPackFragmentItem`, `PromptPackVariableItem`
  - `PromptPackImportRequest { pack, mode, dry_run }`
  - `PromptPackImportResult { applied_counts, warnings, errors }`
- `App/backend/services/prompt_pack_service.py` (신규)
  - export: active prompts/fragments/variables를 조회해 `PromptPack` 생성
  - import: mode에 따라 upsert/삭제 처리 + 참조 검증(경고)
- `App/backend/routes/prompt_pack_routes.py` (신규)
  - `GET /api/v1/prompt-packs/export`
    - query: `include=prompts,fragments,variables` (선택)
  - `POST /api/v1/prompt-packs/import`
    - body: `PromptPackImportRequest`
    - query: `dry_run=true` 지원(적용 없이 결과만 반환)
- `App/backend/main.py`에 router 등록

2) Backend: “벌크 저장 시 commit 제어” 개선(권장)
- 현재 `prompt_service.save_new_version()` / `fragment_service.save_new_version()`는 호출마다 `commit()`을 수행함.
- Import를 트랜잭션으로 처리하려면 아래 중 하나가 필요:
  - (A) 서비스 메서드에 `commit: bool = True` 옵션을 추가해 벌크 시 `commit=False`로 누적 후 마지막에 한 번만 commit
  - (B) PromptPackService 내부에서 직접 insert/update를 수행(버전 번호 계산 포함)

3) Backend: 참조 검증(경고용)
- 템플릿에서 `{{prompt "path"}}`로 참조하는 fragment가 누락되면 warning
- `{{variables.xxx}}` 형태의 변수 참조가 누락되면 warning
- handlebars 개수 불일치 같은 간단한 문법 에러는 warning 또는 error(정책 결정)

### 옵션 B) Frontend에서만 Export/Import 구현 (빠른 MVP)

장점:
- 백엔드 변경 없이도 MVP 가능

단점:
- Export/Import 때 요청 수가 많아질 수 있음
- Import 도중 실패하면 “부분 적용”이 발생하기 쉬움(원자성 약함)

구현 개요:
- Export:
  - prompts: `PROMPT_TREE`를 순회하며 `promptService.getPrompt()` 호출
  - fragments: `fragmentService.getAllFragmentsWithContent()`
  - variables: `variableService.getAllVariables()`
  - 합쳐서 JSON 다운로드
- Import:
  - prompts: `promptService.savePrompt(..., note="Imported")` 반복
  - fragments: 존재 여부 확인 후 `createFragment` 또는 `saveFragment`(409 처리)
  - variables: 이름 기반으로 매칭(필요 시 삭제/재생성 정책은 구현 난이도↑)

> 추천은 A(백엔드 벌크)이고, 일정이 급하면 B로 시작 후 A로 마이그레이션하는 “단계적 접근”이 좋다.

---

## 7) Frontend UX 제안(권장)

`Prompts & Templates` 패널에 아래 UI 추가:

- **Export Prompt Pack**
  - 포함 범위 체크: Prompts / Fragments / Variables
  - pack name/description 입력
  - 다운로드 파일명 자동 생성(`prompt-pack_<name>_<YYYYMMDD>.json`)
- **Import Prompt Pack**
  - 파일 선택(JSON)
  - (가능하면) import 모드 선택: merge / replace
  - 적용 전 요약: 변경될 prompts/fragments/variables 개수, 충돌/경고 리스트
  - 적용 후:
    - `settingsStore.invalidatePromptCache()`로 프롬프트 캐시 비우기
    - `PromptManager.reloadFragments()` 호출
    - `variableStore.reset()` 후 `loadVariables()` 재호출(또는 reload)

---

## 8) 테스트/검증 체크리스트(수동)

- 프롬프트/fragment/variable을 각각 수정 → Export → 파일에 변경 내용이 포함되는지 확인
- 다른 세트(또는 초기 상태)에서 Import(merge) → 누락/충돌 경고가 적절한지 확인
- Import(replace)에서 삭제/타입 불일치 정책이 의도대로 동작하는지 확인
- Import 후 실제 LLM 실행 시:
  - 템플릿 렌더링 성공(에러 없이)
  - fragment/variable 참조가 누락되지 않았는지 확인

---

## 9) 작업 단위(구현 로드맵)

### Phase 1 (MVP, JSON + merge)
- [ ] PromptPack JSON 스키마(v1) 정의
- [ ] Export 구현(옵션 A 또는 B)
- [ ] Import(merge) 구현 + 간단한 검증(참조 누락 warning)
- [ ] UI 버튼/모달 최소 구현

### Phase 2 (안정화)
- [ ] Import dry-run + 결과 요약 UI
- [ ] replace 모드(삭제/재생성 정책) + 강한 경고 UX
- [ ] 서비스 commit 최적화/트랜잭션 적용(옵션 A 채택 시 필수)

### Phase 3 (개선)
- [ ] ZIP 포맷 지원(선택)
- [ ] (추가 기능) “Prompt Pack 라이브러리”(최근 사용한 팩 기록, 로컬스토리지에 파일 메타 저장)

