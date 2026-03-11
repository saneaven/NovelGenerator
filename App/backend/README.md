# Novel Buds Backend

A comprehensive backend service for the Novel Buds application, featuring:
- Multi-provider LLM integration (GitHub Copilot, OpenRouter, Custom endpoints)
- PostgreSQL database with SQLAlchemy ORM
- JWT authentication
- RESTful API for story management
- Multilingual support with version history
- Chat conversation management

## Features

- **User Authentication**: Secure JWT-based authentication
- **Project Management**: Create and manage multiple story projects
- **Story Objects**: Characters, Organizations, Locations, Lorebook entries
- **Outline Management**: Acts and Chapters with hierarchical structure
- **Version History**: Track all changes with multilingual support
- **Chapter Content**: Write and version chapter content
- **Chat System**: Manage conversations with AI assistants
- **LLM Integration**: Stream responses from multiple LLM providers

## Technology Stack

- **Framework**: FastAPI
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy 2.0
- **Migrations**: Alembic
- **Authentication**: JWT (python-jose)
- **Password Hashing**: Passlib with bcrypt
- **Validation**: Pydantic v2

## Quick Start

### Prerequisites

1. Python 3.9+
2. PostgreSQL 12+
3. pip or conda

### Installation

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables**:
   Edit `.env` file with your settings:
   ```env
   # Database
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=novel_buds

   # JWT
   JWT_SECRET_KEY=your-secret-key-here

   # LLM Providers
   COPILOT_TOKEN=your-copilot-token
   ```

3. **Create database**:
   ```bash
   createdb -U postgres novel_buds
   ```

4. **Run database initialization**:
   ```bash
   python init_db.py
   ```

5. **Schema management**:
   ```bash
   alembic upgrade head
   ```
   Fresh installs use the repository baseline migration. Add new revisions only when the schema changes after that baseline.

6. **Start the server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

The API will be available at http://localhost:8000

### Interactive API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Project Structure

```
backend/
├── alembic/                    # Database migrations
│   ├── versions/               # Migration files
│   ├── env.py                  # Migration environment
│   └── script.py.mako          # Migration template
├── models/
│   ├── db_models.py            # SQLAlchemy database models
│   └── requests.py             # LLM request models
├── routes/
│   ├── auth_routes.py          # Authentication endpoints
│   ├── project_routes.py       # Project CRUD
│   ├── story_routes.py         # Story objects
│   └── chat_routes.py          # Chat management
├── schemas/
│   ├── auth.py                 # Auth schemas
│   ├── projects.py             # Project schemas
│   ├── story_objects.py        # Story object schemas
│   ├── chapters.py             # Chapter schemas
│   └── chats.py                # Chat schemas
├── providers/
│   ├── copilot.py              # GitHub Copilot provider
│   ├── openrouter.py           # OpenRouter provider
│   └── custom.py               # Custom endpoint provider
├── database.py                 # Database configuration
├── auth.py                     # Authentication utilities
├── main.py                     # FastAPI application
├── init_db.py                  # Database initialization script
├── db_commands.py              # Database management CLI
├── create_migration.py         # Migration helper script
├── .env                        # Environment variables
├── alembic.ini                 # Alembic configuration
├── DATABASE_SETUP.md           # Database setup guide
├── API_DOCUMENTATION.md        # API documentation
└── README.md                   # This file
```

## Database Schema

The database is designed with a user-centric architecture:

### Core Tables
- **users**: User accounts
- **user_settings**: User preferences and LLM configurations
- **projects**: Story projects (1:N with users)

### Story Objects
- **basic_info**: Project metadata (title, logline, genres, tags)
- **characters**: Character entities
- **organizations**: Organization entities
- **locations**: Location entities
- **lorebook_entries**: Lorebook entries
- **outlines**: Story outlines
- **acts**: Act structure (N:1 with outlines)
- **chapters**: Chapter structure (N:1 with acts)

### Version History
- **story_object_versions**: Version history for all story objects
- **chapter_contents**: Chapter content
- **chapter_content_versions**: Chapter content versions

### Chat System
- **chats**: Chat conversations
- **chat_messages**: Chat messages with multilingual support

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Get current user

### Projects
- `POST /api/v1/projects` - Create project
- `GET /api/v1/projects` - List projects
- `GET /api/v1/projects/{id}` - Get project
- `PUT /api/v1/projects/{id}` - Update project
- `DELETE /api/v1/projects/{id}` - Delete project

### Story Objects
- `/api/v1/projects/{project_id}/basic-info` - Basic info
- `/api/v1/projects/{project_id}/characters` - Characters
- `/api/v1/projects/{project_id}/organizations` - Organizations
- `/api/v1/projects/{project_id}/locations` - Locations
- `/api/v1/projects/{project_id}/lorebook` - Lorebook

### Chats
- `POST /api/v1/projects/{project_id}/chats` - Create chat
- `GET /api/v1/projects/{project_id}/chats` - List chats
- `POST /api/v1/projects/{project_id}/chats/{chat_id}/messages` - Add message

For complete API documentation, see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)

## Database Management

### Common Commands

```bash
# Test database connection
python db_commands.py test

# Show all tables
python db_commands.py tables

# Apply migrations
python db_commands.py upgrade

# Rollback migration
python db_commands.py downgrade

# Show migration history
python db_commands.py history

# Reset database (⚠️ DANGER!)
python db_commands.py reset
```

### Creating Migrations

```bash
# Auto-generate from model changes
python create_migration.py "description"

# Create blank migration
alembic revision -m "description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

For detailed database setup instructions, see [DATABASE_SETUP.md](DATABASE_SETUP.md)

## Development

### Running in Development Mode

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The `--reload` flag enables auto-reload on code changes.

### Environment Variables

Required environment variables:
- `DB_USER` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_NAME` - Database name
- `JWT_SECRET_KEY` - Secret key for JWT tokens
- `COPILOT_TOKEN` - GitHub Copilot API token (optional)

### Testing

```bash
# Run tests (when implemented)
pytest

# Run with coverage
pytest --cov=.
```

## Authentication Flow

1. **Register**: `POST /api/v1/auth/register`
   - Create account with email, username, password
   - Returns user object

2. **Login**: `POST /api/v1/auth/login`
   - Authenticate with email and password
   - Returns JWT access token

3. **Authenticated Requests**:
   - Include token in Authorization header:
     ```
     Authorization: Bearer <token>
     ```

4. **Token Expiration**:
   - Tokens expire after 7 days
   - User must login again to get new token

## Multilingual Support

All story objects and chat messages support multiple languages:

```json
{
  "name": "Character Name",
  "description": "Description",
  "language": "English"
}
```

Data is stored as JSONB:
```json
{
  "English": {
    "name": "Character Name",
    "description": "Description"
  },
  "Korean": {
    "name": "캐릭터 이름",
    "description": "설명"
  }
}
```

## Version History

Every story object maintains version history:
- Automatic versioning on create/update
- Multilingual version data
- User request tracking ("User Edit", "AI Edit", etc.)
- Active version management

## Security Considerations

### Production Checklist

- [ ] Change `JWT_SECRET_KEY` to a secure random value
- [ ] Use HTTPS only
- [ ] Restrict CORS origins
- [ ] Implement rate limiting
- [ ] Add request logging
- [ ] Set up monitoring
- [ ] Use connection pooling (PgBouncer)
- [ ] Enable SSL for database connections
- [ ] Implement input validation
- [ ] Add API versioning
- [ ] Set up automated backups
- [ ] Use environment-specific configurations

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Test connection
python db_commands.py test
```

### Migration Issues

```bash
# Show current version
alembic current

# Show pending migrations
alembic history

# Reset migrations (development only!)
python db_commands.py reset
```

### Import Errors

Make sure you're in the backend directory and have installed all dependencies:
```bash
cd App/backend
pip install -r requirements.txt
```

## Contributing

1. Create a feature branch
2. Make changes
3. Create migration if needed
4. Test locally
5. Submit pull request

## License

[Your License Here]

## Support

For issues and questions:
- GitHub Issues: [Your Repo URL]
- Documentation: See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) and [DATABASE_SETUP.md](DATABASE_SETUP.md)
