"""
Default prompt content for the Novel Generator application.

This module contains all default prompts that are initialized for new users.
The structure mirrors the frontend prompts structure defined in:
- App/frontend/src/prompts/defaults.ts
- App/frontend/src/agent/

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
# Agent - Story Object
_STORYOBJECT_SYSTEM_PROMPT = _load_prompt_file('agent/storyObject/systemPrompt.md')
_STORYOBJECT_USER_PROMPT = _load_prompt_file('agent/storyObject/userPrompt.md')
_STORYOBJECT_NON_LAST_USER_PROMPT = _load_prompt_file('agent/storyObject/nonLastUserPrompt.md')
_STORYOBJECT_PREFILL = _load_prompt_file('agent/storyObject/prefill.md')
# Agent - Novel Editor
_NOVEL_EDITOR_SYSTEM_PROMPT = _load_prompt_file('agent/novelEditor/systemPrompt.md')
_NOVEL_EDITOR_USER_PROMPT = _load_prompt_file('agent/novelEditor/userPrompt.md')
_NOVEL_EDITOR_NON_LAST_USER_PROMPT = _load_prompt_file('agent/novelEditor/nonLastUserPrompt.md')
_NOVEL_EDITOR_PREFILL = _load_prompt_file('agent/novelEditor/prefill.md')
# Translation - Object
_TRANSLATION_SYSTEM_PROMPT_OBJECT = _load_prompt_file('translation/object/systemPrompt.md')
_TRANSLATION_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/userPrompt.md')
_TRANSLATION_PREFILL_OBJECT = _load_prompt_file('translation/object/prefill.md')
# Translation - Agent
_TRANSLATION_SYSTEM_PROMPT_AGENT = _load_prompt_file('translation/agent/systemPrompt.md')
_TRANSLATION_USER_PROMPT_AGENT = _load_prompt_file('translation/agent/userPrompt.md')
_TRANSLATION_PREFILL_AGENT = _load_prompt_file('translation/agent/prefill.md')
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
    'agent': {
        'systemPrompt': {
            'storyObject': _STORYOBJECT_SYSTEM_PROMPT,
            'novelEditor': _NOVEL_EDITOR_SYSTEM_PROMPT,
        },
        'userPrompt': {
            'storyObject': _STORYOBJECT_USER_PROMPT,
            'novelEditor': _NOVEL_EDITOR_USER_PROMPT,
        },
        'nonLastUserPrompt': {
            'storyObject': _STORYOBJECT_NON_LAST_USER_PROMPT,
            'novelEditor': _NOVEL_EDITOR_NON_LAST_USER_PROMPT,
        },
        'prefill': {
            'storyObject': _STORYOBJECT_PREFILL,
            'novelEditor': _NOVEL_EDITOR_PREFILL,
        },
    },
    'translation': {
        'systemPrompt': {
            'object': _TRANSLATION_SYSTEM_PROMPT_OBJECT,
            'agent': _TRANSLATION_SYSTEM_PROMPT_AGENT,
        },
        'userPrompt': {
            'object': _TRANSLATION_USER_PROMPT_OBJECT,
            'agent': _TRANSLATION_USER_PROMPT_AGENT,
        },
        'prefill': {
            'object': _TRANSLATION_PREFILL_OBJECT,
            'agent': _TRANSLATION_PREFILL_AGENT,
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
