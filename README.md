# Mal-Bud : AI Novel Companion

**Mal-Bud** is an advanced AI-powered platform designed to assist authors in creating immersive worlds and writing compelling novels. It seamlessly integrates world-building tools with a powerful novel editor, all enhanced by an intelligent AI assistant that understands your story's context.

## 🌟 Key Features

### 🏗️ World Building Workspace
Design your novel's universe with the help of AI.
- **Character Management**: Create detailed profiles for your characters.
- **World Elements**: Define locations, organizations, and lore.
- **Interactive Chat**: Discuss and brainstorm ideas with the AI, which can automatically update your world settings based on the conversation.

### ✍️ Novel Editor
A dedicated writing environment integrated with your world data.
- **Context-Aware AI**: The AI assistant has access to your characters, locations, and plot outlines, providing consistent and relevant suggestions.
- **Chapter Management**: Organize your story into acts and chapters.
- **Seamless Editing**: Write your story while consulting the AI for ideas, dialogue, or descriptions.

### 🌍 Multi-Language Support
Break language barriers in your creative process.
- **Bilingual Capabilities**: Input in your native language and generate output in another (e.g., Korean to English), or vice versa.
- **Style Adaptation**: Instruct the AI to adopt specific literary styles appropriate for the target language.

### ⚙️ Advanced AI Configuration
Tailor the AI to your needs.
- **Model Selection**: Choose from various AI models and providers.
- **Custom Settings**: Adjust temperature, system prompts, and thinking capabilities.
- **Function Calling**: The AI can autonomously perform actions like creating new characters or updating chapter content.

### 🔄 Version Control & Project Management
- **Project Organization**: Manage multiple novel projects simultaneously.
- **Data Safety**: Your world data and story progress are structured and saved securely.

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite
- **Language**: TypeScript
- **State Management**: Zustand
- **Routing**: React Router DOM
- **Styling**: CSS Modules
- **Utilities**: Axios, Zod, Marked, DOMPurify

### Backend
- **Framework**: FastAPI (Python)
- **Database**: SQLite / SQLAlchemy (with Alembic for migrations)
- **AI Integration**: OpenAI API / Custom Providers
- **Validation**: Pydantic

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- Python (v3.10 or higher)

### Installation

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd NovelGenerator
    ```

2.  **Backend Setup**
    ```bash
    cd App/backend
    python -m venv venv
    # Activate virtual environment (Windows: venv\Scripts\activate, Mac/Linux: source venv/bin/activate)
    pip install -r requirements.txt
    # Run migrations
    alembic upgrade head
    ```

3.  **Frontend Setup**
    ```bash
    cd App/frontend
    npm install
    ```

### Running the Application

1.  **Start the Backend**
    ```bash
    cd App/backend
    python main.py
    ```

2.  **Start the Frontend**
    ```bash
    cd App/frontend
    npm run dev
    ```

3.  Open your browser and navigate to `http://localhost:5173` (or the port shown in your terminal).

## 📂 Project Structure

```
NovelGenerator/
├── App/
│   ├── backend/                  # FastAPI Backend Server
│   │   ├── alembic/              # Database schema migrations (SQLAlchemy/Alembic)
│   │   ├── data/                 # Static data and template registries
│   │   ├── models/               # Database ORM models
│   │   ├── prompts/              # System prompts and templates for LLM interaction
│   │   ├── providers/            # LLM provider implementations (OpenAI, Custom, etc.)
│   │   ├── routes/               # API endpoint definitions
│   │   ├── schemas/              # Pydantic models for request/response validation
│   │   ├── services/             # Core business logic and application services
│   │   └── utils/                # Shared utility functions and helpers
│   └── frontend/                 # React Frontend Application
│       ├── src/
│       │   ├── api/              # Backend API integration layer
│       │   ├── chat/             # Chat engine, message processing, and streaming logic
│       │   ├── components/       # Reusable UI components and modals
│       │   ├── hooks/            # Custom React hooks
│       │   ├── pages/            # Main application views (Editor, Workspace, etc.)
│       │   ├── store/            # Global state management (Zustand)
│       │   ├── styles/           # Global styling and theming
│       │   └── templateEngine/   # Frontend template processing engine
├── StartBackend.bat              # Windows script to launch backend
└── StartFrontend.bat             # Windows script to launch frontend
```

## 📝 License

TBD
