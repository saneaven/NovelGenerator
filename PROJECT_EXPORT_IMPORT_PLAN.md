# 프로젝트 Export/Import 기능 추가 계획서

## 목표 (User Story)
- 사용자가 프로젝트의 **Config(WorkspaceConfigPanel)** 에서 “Export Project”를 실행한다.
- Export 결과물(단일 파일)을 공유하면, 다른 유저가 “Import Project”로 가져와서 **동일한 프로젝트 데이터를 새 프로젝트로** 생성하고 그대로 편집/실행(이미지 포함)할 수 있다.
- 기본값은 **최신 저장(서버 DB) 기준 데이터 + 실제로 사용 중인 이미지들만** 포함한다.
- 이미지 정리(Image Cleanup) UX처럼, **Export에 포함할 항목을 유저가 선택/제어**할 수 있다.

---

## 현 구조 분석 (관련 코드/데이터 흐름)

### 1) 이미지(Asset) 저장 구조
- 이미지 파일은 백엔드 로컬 스토리지에 저장됨:
  - `App/backend/main.py`에서 `App/backend/storage/assets`를 정적 서빙으로 마운트
  - URL 패턴: `/storage/assets/{relative_path}`
- DB 모델:
  - `App/backend/models/db_models.py`
    - `Asset`: `file_path`, `thumbnail_path`, `asset_type(scene|object|null)`, `manuscript_id(owned_assets)` 등
    - `StoryObjectAsset`: 스토리 오브젝트(캐릭터 등) ↔ Asset 링크, `is_main`
    - `ManuscriptImage`: 원고 내 삽입 이미지 인덱스(주로 asset_id)
- 파일 IO:
  - `App/backend/services/storage_service.py`
    - `save_uploaded_file`, `save_generated_image`, `read_asset_file`, `delete_asset_files`

### 2) “사용 중인 이미지” 판단 로직(이미 존재)
- 이미지 정리(Image Cleanup) 로직이 “사용/미사용” 분류를 이미 구현:
  - 백엔드: `App/backend/routes/asset_routes.py` (`/cleanup/preview`, `/cleanup/execute`)
  - 정책 스키마: `App/backend/schemas/assets.py`의 `ImageCleanupPolicy`
  - 프론트 UI: `App/frontend/src/pages/UnifiedWorkspace/components/WorkspaceConfigPanel.tsx`
- 핵심 판단 기준(현재 구현 기준):
  - 원고에서 사용 중: `ManuscriptImage.asset_id`에 등장하는 `Asset.id`
  - 스토리 오브젝트 이미지: `StoryObjectAsset.is_main == True`(메인) / 비메인은 옵션
  - 생성 레퍼런스 이미지: `Asset.generation_reference_images`에서 참조되는 자산을 “used”로 간주할지 옵션(`treat_reference_images_as_used`)

### 3) 프로젝트 데이터(“최신 버전”) 저장 구조
- 번역/버전 시스템:
  - `App/backend/models/translation_models.py`
    - `ObjectVersion`: 버전 히스토리(현재는 **create_new 시 편집 언어만** 저장될 수 있음)
    - `ObjectTranslation`: 언어별 캐시 + `is_active`
  - 생성/수정 로직:
    - `App/backend/routes/unified_object_routes.py`의 `create_or_update_version`, `update_translation_cache`
    - `create_new=True`: 새 버전 생성(기본), **편집 언어만 포함 → 타 언어는 stale**
    - `create_new=False`: 최신 버전을 in-place 업데이트(번역 추가 등에 사용)
- 프로젝트의 “최신 데이터”를 무엇으로 정의할지:
  - **MVP 제안**: 각 오브젝트별 “최신 ObjectVersion 1개 + ObjectTranslation 전체(언어/활성 상태 포함)”를 export
  - 이렇게 하면,
    - 원고/월드 최신 저장 상태(서버) 재현
    - stale 번역도 동일하게 유지(현재 시스템 동작과 일치)

---

## Export 파일 포맷 제안 (단일 zip 컨테이너)

### 파일 확장자
- 사용자 경험상 `.nbproj` 또는 `.novelbuds.zip` 같은 고정 확장자 권장
  - 구현은 zip이 가장 단순(FastAPI에서 스트리밍 용이)

### 내부 구조(예시)
```
manifest.json
data/project.json
assets/originals/<export_asset_key>
assets/thumbnails/<export_asset_key>
```

### `manifest.json` (권장 필드)
- `format_version`: 숫자 (예: `1`)
- `exported_at`: ISO string
- `app_version`: 백엔드 `app.version` 또는 git sha(선택)
- `source`: `{ project_name, project_description }` (민감정보 제외)
- `policy`: export 시 사용한 옵션들
- `counts`: `{ objects, assets, bytes }`
- `checksums`: (선택) 파일 무결성 확인용

### `data/project.json` (권장)
- “DB 덤프”가 아니라, **Import 시 재구성 가능한 도메인 스냅샷** 형태 권장:
  - `project`: name/description
  - `core_objects`: BasicInfo/Guidelines/Characters/…
  - `outline_tree`: outlines → acts → chapters → manuscripts
  - `translations`:
    - `latest_versions`: object_type+object_id → {version_number, data}
    - `translation_cache`: object_type+object_id+language → {data, is_active}
  - `assets_metadata`: assets + story_object_assets + manuscript_images(필요 시)
  - `agents`: agents + agent_messages(옵션)

---

## UX/기능 설계 (프론트)

### A) Export (Workspace Config에 추가)
기존 `WorkspaceConfigPanel.tsx`의 Image Cleanup 카드 아래(또는 별도 카드)로 추가:
- 섹션 제목: `Project Export`
- 옵션(초기 제안, 토글/체크박스):
  - `Include images` (default: on)
  - `Images: used only` (default: on)
  - `Include non-main story object images` (default: off)
  - `Include generation reference images` (default: on) — 의존성 포함
  - `Include chat history` (default: off)
  - `Include version history` (default: off) — MVP는 최신만
- 버튼:
  - `Preview` → 후보/용량/개수 프리뷰 (Image Cleanup처럼)
  - `Export` → zip 다운로드
- 프리뷰 UI(최소):
  - 이미지 후보 리스트(체크박스) + 총합 용량/개수
  - 데이터 카테고리별 포함 여부/카운트(읽기 전용이라도 OK)

### B) Import (Home에 추가)
`App/frontend/src/pages/Home.tsx`의 `New Project` 옆에:
- `Import Project` 버튼 추가
- 파일 선택(accept: `.nbproj,.zip` 등)
- (선택) 프로젝트명 override 입력
- 완료 시 `ProjectResponse` 반환받아 리스트에 추가 후 `/project/{new_id}`로 이동

---

## API 설계 (백엔드)

### 1) Preview
- `POST /api/v1/projects/{project_id}/export/preview`
  - body: `ExportPolicy`
  - response: `ExportPreviewResponse`
    - `assets`: 후보 리스트(Asset id/name/type/file_size/thumbnail_url 등)
    - `summary`: `{ total_assets, total_bytes, object_counts_by_type, ... }`

### 2) Export 실행(다운로드)
- `POST /api/v1/projects/{project_id}/export`
  - body: `{ policy: ExportPolicy, asset_ids?: string[] }`
  - response: `StreamingResponse` (zip)
  - 헤더: `Content-Disposition: attachment; filename="..."`

### 3) Import
- `POST /api/v1/projects/import`
  - multipart: `file` + (선택) `project_name_override`
  - response: `ProjectResponse` (새로 생성된 프로젝트)

구현 파일 제안:
- `App/backend/schemas/project_transfer.py` (export/import 스키마)
- `App/backend/routes/project_transfer_routes.py` (라우터)
- `App/backend/services/project_transfer_service.py` (핵심 로직 분리)
- `App/backend/main.py`에 router include

---

## “사용 중인 이미지” Export 정책(권장)

### 기본 used-set 계산(백엔드)
- `used_in_manuscripts`: `ManuscriptImage.asset_id` distinct (해당 project의 Asset만)
- `main_story_object_assets`: `StoryObjectAsset.is_main==True`가 가리키는 `asset_id` (해당 project의 Asset만)
- 옵션:
  - `include_non_main_story_object_images`: `is_main==False`까지 포함
  - `include_generation_reference_images`:
    - 선택된 asset들의 `generation_reference_images[*].asset_id`를 따라가며 의존성 closure 포함

### 프리뷰 UX(이미지 정리와 동일 패턴)
- 프리뷰 결과의 asset 리스트를 기본 “전체 선택”으로 제공
- 사용자가 불필요한 자산을 체크 해제 가능

---

## Import 시 가장 중요한 포인트: ID 리매핑 + 참조 재작성

이 프로젝트는 다수 테이블이 UUID를 사용하지만, 번역 테이블(`object_translations`, `object_versions`)은 `project_id`가 없고 `object_id` 기반 unique 제약이 있어 **원본 UUID를 그대로 재사용하면 충돌 위험**이 큼.

### 필수: 전체 ID 재생성(권장)
- 새 프로젝트 생성 시:
  - `project_id`: 새 UUID
  - 모든 core object id(예: `basic_info.id`, `character.id`, `outline.id`, `manuscript.id` 등): 새 UUID
  - asset id: 새 UUID
  - agent/agent_message id: 새 UUID

### 참조 재작성 대상(대표)
- 관계 FK:
  - outline → project
  - act → outline
  - chapter → act
  - manuscript → chapter
  - asset → project / asset.manuscript_id
  - story_object_assets: object_id + asset_id
  - manuscript_images: manuscript_id + asset_id + story_object_id
  - agent_messages: agent_id
- JSON 내부 참조(깨지기 쉬움):
  - 원고 TipTap doc의 이미지 노드:
    - attrs의 `data-asset-id` / `assetId`
    - attrs의 `src` (기존 `/storage/assets/...` 경로가 import 후 바뀜)
  - `Asset.generation_reference_images[*].asset_id`
  - `Asset.generation_reference_objects[*].id` (스토리 오브젝트 id)

### Import 순서(안전한 삽입 순서)
1. Project
2. Core objects(기본 정보/가이드/캐릭터 등)
3. Outline tree(outlines → acts → chapters → manuscripts)
4. ObjectTranslation/ObjectVersion (단, 원고 doc은 asset 매핑 이후 재작성 필요)
5. Assets(파일 저장 + DB row 생성)
6. StoryObjectAsset / ManuscriptImage / Agents / AgentMessages
7. (권장) `rebuild_manuscript_images_for_language`를 언어별로 실행하여 인덱스 정합성 확보

---

## MVP 범위 제안 (1차 릴리즈)
- Export:
  - 최신 ObjectVersion 1개 + ObjectTranslation 전체
  - 프로젝트 전체 데이터를 1개의 zip으로 다운로드
  - 이미지: 기본 “used only + reference images 포함”, UI에서 개별 체크 해제 가능
- Import:
  - zip 업로드 → 새 프로젝트로 생성
  - ID 전량 재생성 + 원고 doc의 이미지 참조 재작성(data-asset-id/src)
  - 썸네일은 import 시 재생성(단순화)
- UI:
  - Workspace Config에 Export 카드 추가
  - Home에 Import 버튼 추가

---

## 2차(확장) 아이디어
- “데이터 선택”을 더 세밀하게:
  - 월드 데이터만 / 원고만 / 채팅만 등 카테고리 단위 export
  - 캐릭터 일부만 export 같은 “부분 export”(의존성 그래프 필요)
- 버전 히스토리 포함 옵션(on):
  - `ObjectVersion` 전체 export/import (용량↑, 구현 복잡↑)
- Export/Import 진행률 표시(대용량 이미지 대응)
- 중복 import 감지(동일 패키지 해시) 및 경고

---

## 구현 체크리스트 (작업 순서)
1. 백엔드 스키마/라우트 설계 (`ExportPolicy`, preview/execution/import)
2. “used assets” 계산 로직을 서비스로 분리(기존 cleanup 로직 재사용)
3. zip 생성(StreamingResponse) + manifest/data 생성
4. import 파서 + 검증(포맷 버전, 용량 제한, zip-slip 방지)
5. ID 매핑 + 원고 doc/asset metadata 참조 재작성
6. 프론트:
   - export UI + preview/다운로드
   - import UI + 업로드/결과 처리
7. 테스트:
   - export→import 후 원고 이미지가 정상 표시되는지
   - 캐릭터 메인 이미지/커버 이미지가 유지되는지
   - 선택 해제한 이미지가 패키지에서 제외되는지

