"""
Default prompt content for the Novel Generator application.

This module contains all default prompts that are initialized for new users.
The structure mirrors the frontend prompts structure defined in:
- App/frontend/src/prompts/defaults.ts
- App/frontend/src/chat/managers/prompts/

Format: {function_type: {category: {name?: content}}}
"""

from pathlib import Path

# Get the current directory (App/backend/prompts/)
CURRENT_DIR = Path(__file__).parent
TEMPLATES_DIR = CURRENT_DIR / 'templates'


def _load_prompt_file(relative_path: str) -> str:
    """
    Load a prompt file from the templates directory.

    Args:
        relative_path: Path relative to the templates directory

    Returns:
        str: Content of the prompt file
    """
    file_path = TEMPLATES_DIR / relative_path
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Warning: Prompt file not found: {file_path}")
        return f"# Default prompt (file not found: {relative_path})"


# Load all prompts from files
# Chat - Workspace
_WORKSPACE_SYSTEM_PROMPT = _load_prompt_file('chat/workspace/systemPrompt.md')
_WORKSPACE_USER_PROMPT = _load_prompt_file('chat/workspace/userPrompt.md')
_WORKSPACE_NON_LAST_USER_PROMPT = _load_prompt_file('chat/workspace/nonLastUserPrompt.md')
_WORKSPACE_PREFILL = _load_prompt_file('chat/workspace/prefill.md')
# Chat - Novel Editor
_NOVEL_EDITOR_SYSTEM_PROMPT = _load_prompt_file('chat/novelEditor/systemPrompt.md')
_NOVEL_EDITOR_USER_PROMPT = _load_prompt_file('chat/novelEditor/userPrompt.md')
_NOVEL_EDITOR_NON_LAST_USER_PROMPT = _load_prompt_file('chat/novelEditor/nonLastUserPrompt.md')
_NOVEL_EDITOR_PREFILL = _load_prompt_file('chat/novelEditor/prefill.md')
# Translation - Story
_TRANSLATION_SYSTEM_PROMPT_STORY = _load_prompt_file('translation/story/systemPrompt.md')
_TRANSLATION_USER_PROMPT_STORY = _load_prompt_file('translation/story/userPrompt.md')
_TRANSLATION_PREFILL_STORY = _load_prompt_file('translation/story/prefill.md')
# Translation - Chat
_TRANSLATION_SYSTEM_PROMPT_CHAT = _load_prompt_file('translation/chat/systemPrompt.md')
_TRANSLATION_USER_PROMPT_CHAT = _load_prompt_file('translation/chat/userPrompt.md')
_TRANSLATION_PREFILL_CHAT = _load_prompt_file('translation/chat/prefill.md')
# Story Object Edit
_STORY_EDIT_SYSTEM_PROMPT = _load_prompt_file('storyObjectEdit/systemPrompt.md')
_STORY_EDIT_USER_PROMPT = _load_prompt_file('storyObjectEdit/userPrompt.md')
_STORY_EDIT_PREFILL = _load_prompt_file('storyObjectEdit/prefill.md')
# Manuscript Edit
_MANUSCRIPT_EDIT_SYSTEM_PROMPT = _load_prompt_file('manuscriptEdit/systemPrompt.md')
_MANUSCRIPT_EDIT_USER_PROMPT = _load_prompt_file('manuscriptEdit/userPrompt.md')
_MANUSCRIPT_EDIT_PREFILL = _load_prompt_file('manuscriptEdit/prefill.md')
# Image Prompt - Object
_OBJECT_IMAGE_PROMPT_SYSTEM_PROMPT = _load_prompt_file('imagePrompt/object/systemPrompt.md')
_OBJECT_IMAGE_PROMPT_USER_PROMPT = _load_prompt_file('imagePrompt/object/userPrompt.md')
_OBJECT_IMAGE_PROMPT_PREFILL = _load_prompt_file('imagePrompt/object/prefill.md')
# Image Prompt - Scene
_SCENE_IMAGE_PROMPT_SYSTEM_PROMPT = _load_prompt_file('imagePrompt/scene/systemPrompt.md')
_SCENE_IMAGE_PROMPT_USER_PROMPT = _load_prompt_file('imagePrompt/scene/userPrompt.md')
_SCENE_IMAGE_PROMPT_PREFILL = _load_prompt_file('imagePrompt/scene/prefill.md')

# Default prompts structure
# Format matches the frontend structure: {function_type: {category: {name?: content}}}
DEFAULT_PROMPTS = {
    'chat': {
        'systemPrompt': {
            'workspace': _WORKSPACE_SYSTEM_PROMPT,
            'novelEditor': _NOVEL_EDITOR_SYSTEM_PROMPT,
        },
        'userPrompt': {
            'workspace': _WORKSPACE_USER_PROMPT,
            'novelEditor': _NOVEL_EDITOR_USER_PROMPT,
        },
        'nonLastUserPrompt': {
            'workspace': _WORKSPACE_NON_LAST_USER_PROMPT,
            'novelEditor': _NOVEL_EDITOR_NON_LAST_USER_PROMPT,
        },
        'prefill': {
            'workspace': _WORKSPACE_PREFILL,
            'novelEditor': _NOVEL_EDITOR_PREFILL,
        },
    },
    'translation': {
        'systemPrompt': {
            'story': _TRANSLATION_SYSTEM_PROMPT_STORY,
            'chat': _TRANSLATION_SYSTEM_PROMPT_CHAT,
        },
        'userPrompt': {
            'story': _TRANSLATION_USER_PROMPT_STORY,
            'chat': _TRANSLATION_USER_PROMPT_CHAT,
        },
        'prefill': {
            'story': _TRANSLATION_PREFILL_STORY,
            'chat': _TRANSLATION_PREFILL_CHAT,
        },
    },
    'storyObjectEdit': {
        'systemPrompt': _STORY_EDIT_SYSTEM_PROMPT,
        'userPrompt': _STORY_EDIT_USER_PROMPT,
        'prefill': _STORY_EDIT_PREFILL,
    },
    'manuscriptEdit': {
        'systemPrompt': _MANUSCRIPT_EDIT_SYSTEM_PROMPT,
        'userPrompt': _MANUSCRIPT_EDIT_USER_PROMPT,
        'prefill': _MANUSCRIPT_EDIT_PREFILL,
    },
    'imagePrompt': {
        'systemPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_SYSTEM_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_SYSTEM_PROMPT,
        },
        'userPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_USER_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_USER_PROMPT,
        },
        'prefill': {
            'object': _OBJECT_IMAGE_PROMPT_PREFILL,
            'scene': _SCENE_IMAGE_PROMPT_PREFILL,
        },
    },
}


def get_default_prompts():
    """
    Get the default prompts dictionary.

    Returns:
        dict: Default prompts in the format {function_type: {category: {name?: content}}}
    """
    return DEFAULT_PROMPTS
