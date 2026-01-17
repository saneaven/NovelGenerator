# Local Mode Design / Implementation Plan

## 1) Goals

- Add a **Local Mode** that stores data **locally instead of on the server** (projects, story objects, manuscripts, images/assets).
- Enter Local Mode from the login page (`App/frontend/src/pages/Login.tsx`) via a **"Start in Local Mode"** button.
- In Local Mode, run as a **single local user** (no login/register required) and allow create/read/update operations without the backend.

## 2) Current Architecture Summary (What exists today)

### 2.1 Auth + Routing

- `App/frontend/src/router.tsx`
  - `ProtectedRoute` runs `useAuthStore().checkAuth()` and redirects to `/login` when not authenticated.
- `App/frontend/src/store/authStore.ts`
  - Uses `authService` (`/api/v1/auth/*`) and stores the token in `localStorage(auth_token)`.

### 2.2 Server-backed Data

- Projects: `App/frontend/src/api/projectService.ts` -> `/api/v1/projects`
- Unified Objects (story objects + manuscripts): `App/frontend/src/api/unifiedObjectService.ts`
  - `/api/v1/projects/{projectId}/objects/{type}`
  - `/api/v1/objects/{type}/{id}`, etc.
- Assets/Images: `App/frontend/src/api/assetService.ts` -> `/api/v1/assets/{projectId}/*`
  - Upload uses `apiClient.postFormData()`
  - Backend returns `asset.file_url` / `thumbnail_url` as `"/storage/assets/..."`.
  - UI usually renders as `src={`${API_BASE_URL}${asset.file_url}`}`.
- Backend file storage:
  - `App/backend/services/storage_service.py` stores files under `App/backend/storage/assets` (originals + thumbnails).

### 2.3 Editor Image Insertion (Key constraint)

- `App/frontend/src/pages/noveleditor/components/NovelEditorPanel.tsx`
  - Inserts images into manuscript HTML as a concrete `img src` string:
    - `newSrc = `${API_BASE_URL}${asset.file_url}``
  - Therefore Local Mode needs a **stable URL scheme** that still works after refresh/restart.

## 3) Local Mode Scope

### 3.1 MVP (Recommended)

- Project create/list/update/delete
- Unified objects CRUD (basic info, character, location, organization, lorebook, outline, act, chapter, manuscript)
- Manuscript (HTML) save/load + version creation (similar semantics to server mode)
- Asset upload/list/delete/rename + insert into editor

### 3.2 Optional / Later

- Agents (chat) + message persistence
- Prompt templates / fragments / variables (Settings modal features)
- Server <-> Local migration (download from server / upload to server)
- Image generation in Local Mode (either direct provider calls or backend-assisted)

## 4) Proposed Architecture

### 4.1 App Mode + Session

- Add `appMode: 'server' | 'local'` persisted in `localStorage` (e.g. `app_mode`).
- Update routing:
  - Allow access when `isAuthenticated === true` **or** `appMode === 'local'`.
  - Prevent returning to login/register in Local Mode (`PublicRoute` should redirect to `/`).
- Login page:
  - Add "Start in Local Mode" button.
  - On click:
    1) set `app_mode=local`
    2) (optional) set a pseudo user in `authStore` (e.g., username "Local User")
    3) navigate to `/`

### 4.2 Storage Provider Layer (Server vs Local)

To avoid sprinkling `if (localMode)` everywhere, introduce a provider layer.

**Option A (preferred): interface + two implementations**

- Define per-domain interfaces (projects, unified objects, assets).
- Implementations:
  - `Server*Service`: current `src/api/*.ts` behavior
  - `Local*Service`: IndexedDB-backed
- Provide factories (e.g. `getProjectService()`) that return the correct implementation by current mode.

**Option B (alternative): intercept inside `apiClient`**

- Teach `apiClient.request()` to handle `/api/v1/...` locally when `appMode==='local'`.
- Pros: fewer call-site changes
- Cons: `apiClient` becomes a mini-backend; higher complexity long-term.

### 4.3 Local Persistence: IndexedDB + (Optional) Service Worker for asset URLs

Why IndexedDB:
- `localStorage` is too small for images and large manuscripts.
- IndexedDB supports larger storage + Blob values.

Stable asset URLs (important):
- `blob:` URLs are not stable across sessions
- `data:` URLs explode storage/performance

Recommended approach:
- Store `asset.file_url` as a stable local path, e.g. `/local-assets/{assetId}`
- Register a Service Worker that intercepts `/local-assets/*` requests and serves the Blob from IndexedDB:
  - `/local-assets/{assetId}` -> original blob
  - `/local-assets/{assetId}/thumb` -> thumbnail blob

## 5) Local DB Schema (Draft)

DB name example: `novel_generator_local` (versioned)

- `projects` (key: `projectId`)
- `unified_objects` (key: `objectId`, indexes: `project_id`, `type`, `project_id+type`)
- `object_versions` (optional; key: `versionId`, index: `objectId`)
- `assets_meta` (key: `assetId`, indexes: `project_id`, `asset_type`, `manuscript_id`)
- `assets_blob` (key: `assetId`, value: `{ blob, thumbnailBlob? }`)
- `story_object_assets` (optional; key: `${objectType}:${objectId}`)

All records should match existing frontend response types as closely as possible to minimize UI changes.

## 6) Implementation Roadmap (Checklist)

### Phase 0 - Entry + routing (1-2 days)

- [ ] Add app mode persistence helpers
- [ ] Add "Start in Local Mode" button to `Login.tsx`
- [ ] Update `router.tsx` guards to allow Local Mode
- [ ] Show a "LOCAL MODE" badge + an "Exit Local Mode" action (confirm before clearing)

### Phase 1 - Local Projects (1-2 days)

- [ ] Implement LocalProjectService (IndexedDB)
- [ ] Wire `useProjectStore` to use server/local service based on mode
- [ ] Verify Home project list/create/delete works offline

### Phase 2 - Local Unified Objects + manuscripts (3-6 days)

- [ ] Implement LocalUnifiedObjectService:
  - `createObject`, `listObjects`, `getObject`, `updateObject`, `deleteObject`
  - version creation (`create_new_version`)
  - add/delete translations per language
  - reorder support via `metadata.order`
- [ ] Wire `useUnifiedObjectStore` to the local service
- [ ] Verify `UnifiedWorkspace` story objects, outline, and editor work

### Phase 3 - Local Assets + editor insertion (3-7 days)

- [ ] Implement LocalAssetService:
  - File -> Blob storage + thumbnail generation (canvas)
  - metadata compatible with `Asset`
  - stable `file_url` under `/local-assets/...`
- [ ] Add Service Worker: serve `/local-assets/*` from IndexedDB
- [ ] Normalize asset URL building in UI (avoid hard-coding `API_BASE_URL` assumptions)
- [ ] Update editor image insertion to use local URLs in Local Mode

### Phase 4 - Optional: settings/prompts/variables/fragments (2-5 days)

- [ ] Settings already persist locally; skip server sync in Local Mode.
- [ ] For prompts/variables/fragments:
  - (A) implement locally, or
  - (B) disable/hide UI with an explanatory message in Local Mode.

### Phase 5 - Export / Import (2-6 days)

- [ ] Export a project (JSON + asset blobs)
- [ ] Import (recommended: import into a new local project to avoid collisions)
- [ ] (optional) server <-> local migration utilities

## 7) Risks / Decisions

- Storage quotas: many images may hit browser limits -> need export/cleanup UX.
- Service Worker in dev: caching can block updates -> versioning + dev toggles needed.
- Security: storing API keys locally requires clear warnings/policy.
- AI/image generation: backend dependency is strong; MVP should disable or make it optional.

## 8) Expected Touch Points (Draft)

- `App/frontend/src/pages/Login.tsx`
- `App/frontend/src/router.tsx`
- (optional) `App/frontend/src/pages/Home.tsx` (Local badge / exit)
- New: `App/frontend/src/.../appModeStore.ts` (or similar)
- New: `App/frontend/src/.../localdb/*`
- New: `App/frontend/src/service-worker.ts` (or `public/sw.js`)
- Stores to rewire:
  - `App/frontend/src/store/projectStore.ts`
  - `App/frontend/src/store/unifiedObjectStore.ts`
  - `App/frontend/src/store/assetStore.ts`

