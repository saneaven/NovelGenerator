# Novel Buds API Documentation

Comprehensive API documentation for the Novel Buds backend service.

## Base URL

```
http://localhost:8000
```

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

---

## Authentication Endpoints

### Register User

```http
POST /api/v1/auth/register
```

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securePassword123"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "johndoe",
  "is_active": true,
  "is_verified": false
}
```

### Login

```http
POST /api/v1/auth/login
```

Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### Get Current User

```http
GET /api/v1/auth/me
```

Get authenticated user information.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "johndoe",
  "is_active": true,
  "is_verified": false
}
```

---

## Project Endpoints

### Create Project

```http
POST /api/v1/projects
```

Create a new story project.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "My Novel",
  "description": "A fantastic adventure story"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "My Novel",
  "description": "A fantastic adventure story",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

### List Projects

```http
GET /api/v1/projects?skip=0&limit=100
```

Get all projects for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `skip` (optional): Number of records to skip (default: 0)
- `limit` (optional): Maximum records to return (default: 100)

**Response:** `200 OK`
```json
{
  "projects": [...],
  "total": 5
}
```

### Get Project

```http
GET /api/v1/projects/{project_id}
```

Get a specific project by ID.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

### Update Project

```http
PUT /api/v1/projects/{project_id}
```

Update project details.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "Updated Novel Title",
  "description": "Updated description"
}
```

**Response:** `200 OK`

### Delete Project

```http
DELETE /api/v1/projects/{project_id}
```

Delete a project and all associated data.

**Headers:** `Authorization: Bearer <token>`

**Response:** `204 No Content`

---

## Story Objects Endpoints

All story object endpoints require the `project_id` in the URL path.

Base path: `/api/v1/projects/{project_id}/`

### Basic Info

#### Create Basic Info
```http
POST /api/v1/projects/{project_id}/basic-info
```

**Request Body:**
```json
{
  "title": "The Great Adventure",
  "logline": "A hero's journey through unknown lands",
  "genres": ["Fantasy", "Adventure"],
  "tags": ["epic quest", "coming of age"],
  "language": "English"
}
```

#### Get Basic Info
```http
GET /api/v1/projects/{project_id}/basic-info
```

#### Update Basic Info
```http
PUT /api/v1/projects/{project_id}/basic-info
```

**Request Body:**
```json
{
  "title": "Updated Title",
  "logline": "Updated logline",
  "genres": ["Sci-Fi"],
  "tags": ["space opera", "survival"],
  "language": "English"
}
```

### Characters

#### Create Character
```http
POST /api/v1/projects/{project_id}/characters
```

**Request Body:**
```json
{
  "name": "John Smith",
  "description": "A brave knight with a mysterious past",
  "language": "English"
}
```

#### List Characters
```http
GET /api/v1/projects/{project_id}/characters
```

#### Get Character
```http
GET /api/v1/projects/{project_id}/characters/{character_id}
```

#### Update Character
```http
PUT /api/v1/projects/{project_id}/characters/{character_id}
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "language": "English"
}
```

#### Delete Character
```http
DELETE /api/v1/projects/{project_id}/characters/{character_id}
```

### Organizations

Same endpoints as Characters, but using `/organizations` path:

- `POST /api/v1/projects/{project_id}/organizations`
- `GET /api/v1/projects/{project_id}/organizations`
- `GET /api/v1/projects/{project_id}/organizations/{org_id}`
- `PUT /api/v1/projects/{project_id}/organizations/{org_id}`
- `DELETE /api/v1/projects/{project_id}/organizations/{org_id}`

### Locations

Same endpoints as Characters, but using `/locations` path:

- `POST /api/v1/projects/{project_id}/locations`
- `GET /api/v1/projects/{project_id}/locations`
- `GET /api/v1/projects/{project_id}/locations/{location_id}`
- `PUT /api/v1/projects/{project_id}/locations/{location_id}`
- `DELETE /api/v1/projects/{project_id}/locations/{location_id}`

### Lorebook

Same endpoints as Characters, but using `/lorebook` path:

- `POST /api/v1/projects/{project_id}/lorebook`
- `GET /api/v1/projects/{project_id}/lorebook`
- `GET /api/v1/projects/{project_id}/lorebook/{entry_id}`
- `PUT /api/v1/projects/{project_id}/lorebook/{entry_id}`
- `DELETE /api/v1/projects/{project_id}/lorebook/{entry_id}`

---

## Chat Endpoints

### Create Chat

```http
POST /api/v1/projects/{project_id}/chats
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "Main Chat"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "name": "Main Chat",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

### List Chats

```http
GET /api/v1/projects/{project_id}/chats
```

Get all chats for a project.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

### Get Chat with Messages

```http
GET /api/v1/projects/{project_id}/chats/{chat_id}
```

Get chat details with all messages.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "chat": {
    "id": "uuid",
    "project_id": "uuid",
    "name": "Main Chat",
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z"
  },
  "messages": [
    {
      "id": "uuid",
      "chat_id": "uuid",
      "role": "user",
      "data": {
        "English": {
          "content": "Hello!"
        }
      },
      "tool_calls": null,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### Update Chat

```http
PUT /api/v1/projects/{project_id}/chats/{chat_id}
```

Update chat name.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "Updated Chat Name"
}
```

### Delete Chat

```http
DELETE /api/v1/projects/{project_id}/chats/{chat_id}
```

Delete a chat and all its messages.

**Headers:** `Authorization: Bearer <token>`

**Response:** `204 No Content`

### Create Message

```http
POST /api/v1/projects/{project_id}/chats/{chat_id}/messages
```

Add a message to a chat.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "role": "user",
  "content": "What should I write about?",
  "language": "English",
  "tool_calls": null
}
```

**Response:** `201 Created`

### List Messages

```http
GET /api/v1/projects/{project_id}/chats/{chat_id}/messages
```

Get all messages in a chat.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

### Update Message

```http
PUT /api/v1/projects/{project_id}/chats/{chat_id}/messages/{message_id}
```

Update message content.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "content": "Updated message content",
  "language": "English"
}
```

### Delete Message

```http
DELETE /api/v1/projects/{project_id}/chats/{chat_id}/messages/{message_id}
```

Delete a message.

**Headers:** `Authorization: Bearer <token>`

**Response:** `204 No Content`

---

## LLM Provider Endpoints

### List Providers

```http
GET /api/v1/providers
```

Get all available LLM providers.

**Response:** `200 OK`
```json
{
  "providers": [
    {
      "name": "copilot",
      "display_name": "GitHub Copilot",
      "supports": ["chat", "models", "functions"],
      "requires_api_key": false,
      "description": "GitHub Copilot API (server-configured)"
    }
  ]
}
```

### Get Models

```http
POST /api/v1/providers/{provider}/models
```

Get available models for a specific provider.

**Request Body:**
```json
{
  "custom_kind": "openai_completion"
}
```

Provider credentials are resolved server-side from `server_credentials`.

### Stream Chat Completions

```http
POST /api/v1/chat/completions/{provider}/stream
```

Stream chat completions from a provider.

**Request Body:**
```json
{
  "model": "gpt-5-mini",
  "messages": [
    {
      "role": "user",
      "content_parts": [
        { "type": "content", "text": "Hello!" }
      ]
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000,
  "custom_kind": "openai_completion",
  "thinking_format": "openai"
}
```

Provider credentials are resolved server-side from `server_credentials`.

**Response:** Server-Sent Events stream

---

## Thread Runtime SSE

### Project Event Stream

```http
GET /api/v1/projects/{project_id}/stream
```

Single SSE stream for both thread runtime events and object synchronization events.

### Object Change Event

Event name: `object:changed`

```json
{
  "project_id": "uuid",
  "ts": "2026-02-19T12:34:56.000000+00:00",
  "batch_id": "uuid",
  "changes": [
    { "action": "created", "object_type": "character", "object_id": "uuid" },
    { "action": "updated", "object_type": "chapter", "object_id": "uuid" },
    { "action": "deleted", "object_type": "manuscript", "object_id": "uuid" }
  ]
}
```

- `action` is one of `created | updated | deleted`
- `object_type` uses external object type names (same strings as frontend `ObjectType`)

### Tool Decision Response

`PATCH /api/v1/threads/{thread_id}/tool-calls/{tool_call_id}` and batch decision APIs return only:

```json
{
  "tool_call": {
    "id": "uuid",
    "status": "applied",
    "result": { "success": true, "message": "..." }
  }
}
```

`new_objects` is no longer part of the response contract.

---

## Error Responses

### 400 Bad Request
```json
{
  "detail": "Error message"
}
```

### 401 Unauthorized
```json
{
  "detail": "Could not validate credentials"
}
```

### 403 Forbidden
```json
{
  "detail": "User account is inactive"
}
```

### 404 Not Found
```json
{
  "detail": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Internal server error"
}
```

---

## Multilingual Support

All story objects and chat messages support multiple languages through JSONB storage.

### Version Data Structure

When updating story objects, versions are created with language-specific data:

```json
{
  "English": {
    "name": "Character Name",
    "description": "Description in English"
  },
  "Korean": {
    "name": "캐릭터 이름",
    "description": "한국어 설명"
  }
}
```

### Language Parameter

Most create/update endpoints accept a `language` parameter to specify which language version to create/update. If not provided, defaults to "English".

---

## Interactive API Documentation

FastAPI provides interactive API documentation at:

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

These interfaces allow you to:
- Browse all endpoints
- See request/response schemas
- Test endpoints directly
- Download OpenAPI specification

---

## Rate Limiting

Currently no rate limiting is implemented. This should be added in production.

## CORS

CORS is configured to allow requests from:
- `http://localhost:5173`
- `http://localhost:3000`
- All origins (wildcard) - should be restricted in production

---

## Best Practices

1. **Always use HTTPS** in production
2. **Implement rate limiting** to prevent abuse
3. **Validate JWT tokens** on every protected endpoint
4. **Use appropriate HTTP status codes**
5. **Handle errors gracefully**
6. **Log all requests** for debugging
7. **Set proper CORS policies** for production
8. **Use environment variables** for sensitive configuration
9. **Implement request timeouts**
10. **Add monitoring and alerting**
