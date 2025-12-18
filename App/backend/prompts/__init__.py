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
# Translation - Object
_TRANSLATION_SYSTEM_PROMPT_OBJECT = _load_prompt_file('translation/object/systemPrompt.md')
_TRANSLATION_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/userPrompt.md')
_TRANSLATION_PREFILL_OBJECT = _load_prompt_file('translation/object/prefill.md')
# Translation - Chat
_TRANSLATION_SYSTEM_PROMPT_CHAT = _load_prompt_file('translation/chat/systemPrompt.md')
_TRANSLATION_USER_PROMPT_CHAT = _load_prompt_file('translation/chat/userPrompt.md')
_TRANSLATION_PREFILL_CHAT = _load_prompt_file('translation/chat/prefill.md')
# Edit Assistant - Manuscript
_EDIT_ASSISTANT_MANUSCRIPT_SYSTEM_PROMPT = _load_prompt_file('editAssistant/manuscript/systemPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_USER_PROMPT = _load_prompt_file('editAssistant/manuscript/userPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_PREFILL = _load_prompt_file('editAssistant/manuscript/prefill.md')
# Edit Assistant - Story Object
_EDIT_ASSISTANT_STORY_OBJECT_SYSTEM_PROMPT = _load_prompt_file('editAssistant/storyObject/systemPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_USER_PROMPT = _load_prompt_file('editAssistant/storyObject/userPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_PREFILL = _load_prompt_file('editAssistant/storyObject/prefill.md')
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
            'object': _TRANSLATION_SYSTEM_PROMPT_OBJECT,
            'chat': _TRANSLATION_SYSTEM_PROMPT_CHAT,
        },
        'userPrompt': {
            'object': _TRANSLATION_USER_PROMPT_OBJECT,
            'chat': _TRANSLATION_USER_PROMPT_CHAT,
        },
        'prefill': {
            'object': _TRANSLATION_PREFILL_OBJECT,
            'chat': _TRANSLATION_PREFILL_CHAT,
        },
    },
    'editAssistant': {
        'systemPrompt': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_SYSTEM_PROMPT,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_SYSTEM_PROMPT,
        },
        'userPrompt': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_USER_PROMPT,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_USER_PROMPT,
        },
        'prefill': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_PREFILL,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_PREFILL,
        },
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


# ============================================================================
# DEFAULT FRAGMENTS
# ============================================================================

FRAGMENTS_DIR = CURRENT_DIR / 'default_fragments'


def _load_fragment_file(relative_path: str) -> str:
    """
    Load a fragment file from the default_fragments directory.

    Args:
        relative_path: Path relative to the default_fragments directory

    Returns:
        str: Content of the fragment file
    """
    file_path = FRAGMENTS_DIR / relative_path
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Warning: Fragment file not found: {file_path}")
        return f"# Default fragment (file not found: {relative_path})"


# Load all default fragments
# Format: {'path/to/fragment': content}
DEFAULT_FRAGMENTS = {
    'common/customThinkingInstruction': _load_fragment_file('common/customThinkingInstruction.md'),
    'common/projectContext/full': _load_fragment_file('common/projectContext/full.md'),
    'common/projectContext/filtered': _load_fragment_file('common/projectContext/filtered.md'),
    'common/editOperations/manuscript': _load_fragment_file('common/editOperations/manuscript.md'),
    'common/editOperations/storyObject': _load_fragment_file('common/editOperations/storyObject.md'),
}


def get_default_fragments():
    """
    Get the default fragments dictionary.

    Returns:
        dict: Default fragments in the format {'folder/name': content}
    """
    return DEFAULT_FRAGMENTS
