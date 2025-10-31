"""
Default prompt content for the Novel Generator application.

This module contains all default prompts that are initialized for new users.
The structure mirrors the frontend prompts structure defined in:
- App/frontend/src/prompts/defaults.ts
- App/frontend/src/chat/managers/prompts/

Format: {function_type: {category: {name?: content}}}
"""

from pathlib import Path

# Get the project root directory
# Backend is at: NovelGenerator/App/backend/
# Frontend prompts are at: NovelGenerator/App/frontend/src/chat/managers/prompts/
BACKEND_DIR = Path(__file__).parent.parent
FRONTEND_PROMPTS_DIR = BACKEND_DIR.parent / 'frontend' / 'src' / 'chat' / 'managers' / 'prompts'


def _load_prompt_file(relative_path: str) -> str:
    """
    Load a prompt file from the frontend prompts directory.

    Args:
        relative_path: Path relative to the frontend prompts directory

    Returns:
        str: Content of the prompt file
    """
    file_path = FRONTEND_PROMPTS_DIR / relative_path
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Warning: Prompt file not found: {file_path}")
        return f"# Default prompt (file not found: {relative_path})"


# Load all prompts from files
_WORKSPACE_SYSTEM_PROMPT = _load_prompt_file('systemPrompts/WorkspaceSystemPrompt.md')
_NOVEL_EDITOR_SYSTEM_PROMPT = _load_prompt_file('systemPrompts/NovelEditorSystemPrompt.md')
_WORKSPACE_FUNCTION_INSTRUCTIONS = _load_prompt_file('systemPrompts/functionInstructions/workspace.md')
_NOVEL_EDITOR_FUNCTION_INSTRUCTIONS = _load_prompt_file('systemPrompts/functionInstructions/novelEditor.md')
_CHAT_PREFILL = _load_prompt_file('prefills/ChatPrefill.md')
_TRANSLATION_SYSTEM_PROMPT = _load_prompt_file('systemPrompts/TranslationPrompt.md')
_TRANSLATION_USER_PROMPT = _load_prompt_file('userPrompts/TranslationUserPrompt.md')
_TRANSLATION_PREFILL = _load_prompt_file('prefills/TranslationPrefill.md')
_STORY_EDIT_SYSTEM_PROMPT = _load_prompt_file('systemPrompts/StoryObjectEditPrompt.md')
_STORY_EDIT_USER_PROMPT = _load_prompt_file('userPrompts/StoryObjectEditUserPrompt.md')
_STORY_EDIT_PREFILL = _load_prompt_file('prefills/StoryObjectEditPrefill.md')
_CHAPTER_EDIT_SYSTEM_PROMPT = _load_prompt_file('systemPrompts/ChapterEditPrompt.md')
_CHAPTER_EDIT_USER_PROMPT = _load_prompt_file('userPrompts/ChapterEditUserPrompt.md')
_CHAPTER_EDIT_PREFILL = _load_prompt_file('prefills/ChapterEditPrefill.md')
_LAST_USER_MESSAGE_TAG = _load_prompt_file('userMessageSystemPrompts/LastUserMessageTag.md')
_NON_LAST_USER_MESSAGE_TAG = _load_prompt_file('userMessageSystemPrompts/NonLastUserMessageTag.md')

# Default prompts structure
# Format matches the frontend structure: {function_type: {category: {name?: content}}}
DEFAULT_PROMPTS = {
    'chat': {
        'systemPrompt': {
            'workspace': _WORKSPACE_SYSTEM_PROMPT,
            'novelEditor': _NOVEL_EDITOR_SYSTEM_PROMPT,
        },
        'functionInstructions': {
            'workspace': _WORKSPACE_FUNCTION_INSTRUCTIONS,
            'novelEditor': _NOVEL_EDITOR_FUNCTION_INSTRUCTIONS,
        },
        'prefill': _CHAT_PREFILL,
        'userMessageTag': {
            'lastMessage': _LAST_USER_MESSAGE_TAG,
            'nonLastMessage': _NON_LAST_USER_MESSAGE_TAG,
        },
    },
    'translation': {
        'systemPrompt': _TRANSLATION_SYSTEM_PROMPT,
        'userPrompt': _TRANSLATION_USER_PROMPT,
        'prefill': _TRANSLATION_PREFILL,
    },
    'storyEdit': {
        'systemPrompt': _STORY_EDIT_SYSTEM_PROMPT,
        'userPrompt': _STORY_EDIT_USER_PROMPT,
        'prefill': _STORY_EDIT_PREFILL,
    },
    'chapterGen': {
        'systemPrompt': _CHAPTER_EDIT_SYSTEM_PROMPT,
        'userPrompt': _CHAPTER_EDIT_USER_PROMPT,
        'prefill': _CHAPTER_EDIT_PREFILL,
    },
}


def get_default_prompts():
    """
    Get the default prompts dictionary.

    Returns:
        dict: Default prompts in the format {function_type: {category: {name?: content}}}
    """
    return DEFAULT_PROMPTS
