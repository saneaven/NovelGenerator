# Settings JSON 단일화 + Active Preset 도메인 분리(is_active) 리디자인 제안서

작성일: 2026-01-26  
전제: **개발 초기 / 기존 유저·데이터 없음 / DB는 초기화(드랍&리크리에이트)해도 OK**.  
목표: “영향 범위/하위호환/마이그레이션” 같은 부담을 무시하고, 앞으로 유지보수가 가장 쉬운 **to‑be 구조**를 정의한다.

---

## 0. 한 줄 결론(To‑Be)

- `user_settings`는 **`settings` JSONB 한 덩어리(단일 소스 오브 트루스)**로만 간다.
- “어떤 프리셋이 활성(active)인가”는 settings가 아니라 **`prompt_presets.is_active` (user_id당 1개)**로 관리한다.

---

## 1. 왜 이렇게 가는가(원칙)

### 1) Settings는 “옵션 집합”이다
- settings는 유저 경험/AI 동작을 바꾸는 옵션 집합이므로 **키가 자주 늘고 바뀐다**.
- 컬럼 기반은 변경이 누적될수록 스키마/라우트/프론트 타입 매핑이 늘어나서 피곤해진다.
- JSON 단일화하면 “새 설정 추가”가 **스키마 문서(Pydantic) + 프론트 Store**에만 집중된다.

### 2) Active Preset은 “프롬프트 프리셋 도메인”이다
- active preset은 UI 설정이라기보다 프롬프트/프래그먼트/변수 데이터의 **현재 선택 상태**다.
- settings에 `activePresetId`를 두면, “프리셋 관리/검색/검증”이 settings 라우트로 빨려 들어가 경계가 흐려진다.
- `prompt_presets.is_active`로 옮기면 preset 도메인에서 완결된다(이미 `/api/v1/presets/active`가 있으니 더 자연스럽다).

---

## 2. DB 스키마(To‑Be)

### 2.1 `user_settings` (극단적으로 단순화)
`user_settings`는 아래만 유지:
- `user_id` (PK, FK users.id)
- `settings` (JSONB, NOT NULL)
- `created_at`, `updated_at`

**삭제 대상(예시)**  
현재 `user_settings`의 개별 컬럼들(`main_language`, `theme`, `rag_search_enabled`, `tool_call_history_limit`, `active_preset_id`, …)은 모두 삭제한다.

### 2.2 `prompt_presets`에 `is_active` 추가
`prompt_presets`에:
- `is_active boolean NOT NULL DEFAULT false`
- **user_id당 active 1개 강제**: Postgres partial unique index

예시(개념):
```sql
CREATE UNIQUE INDEX uq_prompt_presets_user_active
ON prompt_presets(user_id)
WHERE is_active = true;
```

### 2.3 Credentials는 settings에 넣지 않는다
자격증명은 별도 테이블(`user_credentials`) + 암호화 블롭 유지(또는 현 구조 정리).  
settings JSON에는 절대 secret을 넣지 않는다.

---

## 3. Settings JSON 스키마(To‑Be 계약)

### 3.1 핵심 원칙
- **프론트 `Settings`(camelCase) shape = 서버 저장 shape**로 통일한다.
- 서버는 `SettingsDoc`(Pydantic)로 유효성/기본값을 강제한다.

### 3.2 제안 스키마(예시)
```json
{
  "taskConfigs": { "...": "..." },
  "imageGenConfig": { "...": "..." },

  "mainLanguage": "English",
  "subLanguages": [],
  "defaultSubLanguage": null,
  "displayLanguage": "English",
  "uiLanguage": "en",
  "theme": "system",

  "retryConfig": { "...": "..." },
  "nativeOutputMode": false,

  "ragSearchEnabled": false,
  "ragSearchTopKPerQuery": 20,
  "ragSearchNeighborWindow": 0,
  "ragSearchMaxPrimaryChunks": 20,
  "ragSearchMaxTotalChunks": 60,

  "llmLoggingEnabled": false,
  "toolCallHistoryLimit": 5,
  "thinkingHistoryLimit": 5,

  "toolCallAutoApprove": {
    "create": false,
    "delete": false,
    "patch": false,
    "replace": false,
    "read": false,
    "search": false
  }
}
```

> 포인트: “settings는 settings만” 담고, preset 활성 여부는 preset 테이블에서 관리한다.

---

## 4. API(To‑Be)

### 4.1 Settings API는 단순 2종(권장)
- `GET /api/v1/settings` → `SettingsDoc` **그대로 반환**
- `PUT /api/v1/settings` → `SettingsDoc` **전체 교체 저장**

옵션(있으면 편함):
- `PATCH /api/v1/settings` → 부분 업데이트(서버에서 merge 후 저장)

**중요:** 지금처럼 `SettingsSyncResponse`에 필드가 빠지거나 optional인 형태를 없애고, 항상 “완성본”을 준다.

### 4.2 Preset API는 “preset 도메인에서 active 관리”
이미 존재하는 엔드포인트 형태는 유지 가능:
- `GET /api/v1/presets/active`
- `POST /api/v1/presets/active/{preset_id}`

단, 내부 구현은 `user_settings.active_preset_id`가 아니라:
- `prompt_presets.is_active`를 바꾸는 방식으로 전환한다.

### 4.3 Variable/Fragment/Prompt API는 “active preset을 preset에서 조회”
`variable_routes.py`, `fragment_routes.py`, `prompt_routes.py`는:
- `current_user.settings.active_preset_id` 의존을 제거하고,
- `preset_service.get_active_preset_id()`가 `prompt_presets`에서 `is_active=true`를 찾도록 바꾼다.

---

## 5. 백엔드 구현 설계(구조 제안)

### 5.1 모델
- `UserSettings`:
  - `user_id`, `settings(JSONB)`만 가진다.
  - JSONB 변경감지를 위해 둘 중 하나를 선택:
    1) `MutableDict.as_mutable(JSONB)` 사용
    2) 항상 새 dict로 재할당(불변 업데이트 규칙)

- `PromptPreset`:
  - `is_active` 컬럼 추가 + partial unique index

### 5.2 서비스 레이어
- `SettingsService/Repository`
  - `get_settings(user_id) -> SettingsDoc`
  - `put_settings(user_id, SettingsDoc) -> SettingsDoc`
  - (옵션) `patch_settings(user_id, patch) -> SettingsDoc`

- `PresetService`
  - `get_active_preset_id(user_id)`는 `prompt_presets`에서 조회
  - `set_active_preset(user_id, preset_id)`는 트랜잭션으로:
    - 해당 user의 preset들 `is_active=false`
    - target preset `is_active=true`

### 5.3 라우트 수정 포인트(요약)
- `settings_routes.py`: 필드별 if-assign 제거 → settings JSON 전체 저장/반환으로 단순화
- `rag_routes.py`: `UserSettings.rag_search_enabled` 컬럼 참조 제거 → settings JSON에서 `ragSearchEnabled` 읽기
- `preset_routes.py` + `preset_service.py`: active preset 구현을 is_active 기반으로 변경
- `variable_routes.py`, `fragment_routes.py`, `prompt_routes.py`: active preset 조회 경로 변경
- `auth_routes.py`: 회원가입 시 default preset 생성 후 `is_active=true`로 설정

---

## 6. 프론트엔드(To‑Be 영향)

### 6.1 settingsStore는 그대로 유지(오히려 더 단순)
- 이미 프론트는 settings를 하나의 객체로 다루고 있고(`Settings`), 서버 저장도 그 형태로 하도록 통일한다.
- 서버에서 “항상 완성본 settings”를 주면 프론트의 merge/migrate 로직도 줄어든다.

### 6.2 presetStore는 현재 구조가 to‑be와 잘 맞음
- 프론트는 `presetStore.activePresetId`를 별도 관리하고 있고, `/presets/active` API를 사용한다.
- settings에서 active preset을 빼면 프론트 구조가 더 깔끔해진다.

---

## 7. 리셋 기반 실행 플랜(갈아엎기 순서)

> 초기 개발 전제이므로 “깔끔한 리셋”을 목표로 한다.

1) 새 to‑be 모델 반영
- `UserSettings`를 `settings(JSONB)` 단일 컬럼로 축소
- `PromptPreset.is_active` 추가 + partial unique index

2) Alembic 정리
- 기존 버전 파일들은 보관하거나 제거하고,
- 새 baseline(현 모델 그대로 create_all)로 재구성

3) DB 초기화
- 로컬/도커 DB 볼륨 삭제 후 재생성
- `alembic upgrade head`로 새 스키마 생성

4) 라우트/서비스 교체
- settings/preset/active preset 참조 지점들을 to‑be 기준으로 일괄 수정

5) 프론트는 API 계약 변경만 반영
- settings API가 완성본을 돌려주도록 통일
- preset active는 기존 엔드포인트 유지(내부 구현만 바뀜)

---

## 8. 완료 기준(Definition of Done)

- settings 관련 필드가 DB 컬럼에 남아있지 않고 `user_settings.settings`에만 존재
- `/api/v1/settings`가 `SettingsDoc` 전체를 저장/반환
- active preset이 `prompt_presets.is_active`로만 관리되고, user_settings에는 active preset 개념이 없음
- variable/fragment/prompt 조회가 “현재 active preset”을 정상적으로 따라감

---

## 9. (선택) 추가 개선 아이디어

- `prompt_presets` active 강제를 DB partial unique index + 서비스 트랜잭션으로 이중 보장
- settings JSON은 Pydantic validation으로만 강제(서버가 “정상화된 settings”를 반환)
- settings 변경 감사 로그가 필요하면 `settings_history` 테이블로 append-only 기록(나중에)

