"""
Default prompt content for the Novel Buds application.

This module contains all default prompts that are initialized for new users.
The structure mirrors the frontend prompts structure defined in:
- App/frontend/src/prompts/defaults.ts
- App/frontend/src/agent/

Format: {task_type: {category: {name?: content}}}
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
# Agent - Plan Mode
_PLAN_MODE_SYSTEM_PROMPT = _load_prompt_file('agent/planMode/systemPrompt.md')
_PLAN_MODE_MEMORY_PROMPT = _load_prompt_file('agent/planMode/memoryPrompt.md')
_PLAN_MODE_USER_PROMPT = _load_prompt_file('agent/planMode/userPrompt.md')
_PLAN_MODE_FIRST_USER_PROMPT = _load_prompt_file('agent/planMode/firstUserPrompt.md')
_PLAN_MODE_LAST_USER_PROMPT = _load_prompt_file('agent/planMode/lastUserPrompt.md')
_PLAN_MODE_PREFILL = _load_prompt_file('agent/planMode/prefill.md')
# Agent - Agent Mode
_AGENT_MODE_SYSTEM_PROMPT = _load_prompt_file('agent/agentMode/systemPrompt.md')
_AGENT_MODE_MEMORY_PROMPT = _load_prompt_file('agent/agentMode/memoryPrompt.md')
_AGENT_MODE_USER_PROMPT = _load_prompt_file('agent/agentMode/userPrompt.md')
_AGENT_MODE_FIRST_USER_PROMPT = _load_prompt_file('agent/agentMode/firstUserPrompt.md')
_AGENT_MODE_LAST_USER_PROMPT = _load_prompt_file('agent/agentMode/lastUserPrompt.md')
_AGENT_MODE_PREFILL = _load_prompt_file('agent/agentMode/prefill.md')
# Agent - Memory Summary
_MEMORY_SUMMARY_SYSTEM_PROMPT = _load_prompt_file('agent/memorySummary/systemPrompt.md')
_MEMORY_SUMMARY_USER_PROMPT = _load_prompt_file('agent/memorySummary/userPrompt.md')
# Translation - Object
_TRANSLATION_SYSTEM_PROMPT_OBJECT = _load_prompt_file('translation/object/systemPrompt.md')
_TRANSLATION_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/userPrompt.md')
_TRANSLATION_INITIAL_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/initialUserPrompt.md')
_TRANSLATION_FIRST_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/firstUserPrompt.md')
_TRANSLATION_LAST_USER_PROMPT_OBJECT = _load_prompt_file('translation/object/lastUserPrompt.md')
_TRANSLATION_PREFILL_OBJECT = _load_prompt_file('translation/object/prefill.md')
# Translation - Message
_TRANSLATION_SYSTEM_PROMPT_MESSAGE = _load_prompt_file('translation/message/systemPrompt.md')
_TRANSLATION_USER_PROMPT_MESSAGE = _load_prompt_file('translation/message/userPrompt.md')
_TRANSLATION_PREFILL_MESSAGE = _load_prompt_file('translation/message/prefill.md')
# Edit Assistant - Manuscript
_EDIT_ASSISTANT_MANUSCRIPT_SYSTEM_PROMPT = _load_prompt_file('editAssistant/manuscript/systemPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_USER_PROMPT = _load_prompt_file('editAssistant/manuscript/userPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_INITIAL_USER_PROMPT = _load_prompt_file('editAssistant/manuscript/initialUserPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_FIRST_USER_PROMPT = _load_prompt_file('editAssistant/manuscript/firstUserPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_LAST_USER_PROMPT = _load_prompt_file('editAssistant/manuscript/lastUserPrompt.md')
_EDIT_ASSISTANT_MANUSCRIPT_PREFILL = _load_prompt_file('editAssistant/manuscript/prefill.md')
# Edit Assistant - Story Object
_EDIT_ASSISTANT_STORY_OBJECT_SYSTEM_PROMPT = _load_prompt_file('editAssistant/storyObject/systemPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_USER_PROMPT = _load_prompt_file('editAssistant/storyObject/userPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_INITIAL_USER_PROMPT = _load_prompt_file('editAssistant/storyObject/initialUserPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_FIRST_USER_PROMPT = _load_prompt_file('editAssistant/storyObject/firstUserPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_LAST_USER_PROMPT = _load_prompt_file('editAssistant/storyObject/lastUserPrompt.md')
_EDIT_ASSISTANT_STORY_OBJECT_PREFILL = _load_prompt_file('editAssistant/storyObject/prefill.md')
# Image Prompt - Object
_OBJECT_IMAGE_PROMPT_SYSTEM_PROMPT = _load_prompt_file('imagePrompt/object/systemPrompt.md')
_OBJECT_IMAGE_PROMPT_USER_PROMPT = _load_prompt_file('imagePrompt/object/userPrompt.md')
_OBJECT_IMAGE_PROMPT_INITIAL_USER_PROMPT = _load_prompt_file('imagePrompt/object/initialUserPrompt.md')
_OBJECT_IMAGE_PROMPT_FIRST_USER_PROMPT = _load_prompt_file('imagePrompt/object/firstUserPrompt.md')
_OBJECT_IMAGE_PROMPT_LAST_USER_PROMPT = _load_prompt_file('imagePrompt/object/lastUserPrompt.md')
_OBJECT_IMAGE_PROMPT_PREFILL = _load_prompt_file('imagePrompt/object/prefill.md')
# Image Prompt - Scene
_SCENE_IMAGE_PROMPT_SYSTEM_PROMPT = _load_prompt_file('imagePrompt/scene/systemPrompt.md')
_SCENE_IMAGE_PROMPT_USER_PROMPT = _load_prompt_file('imagePrompt/scene/userPrompt.md')
_SCENE_IMAGE_PROMPT_INITIAL_USER_PROMPT = _load_prompt_file('imagePrompt/scene/initialUserPrompt.md')
_SCENE_IMAGE_PROMPT_FIRST_USER_PROMPT = _load_prompt_file('imagePrompt/scene/firstUserPrompt.md')
_SCENE_IMAGE_PROMPT_LAST_USER_PROMPT = _load_prompt_file('imagePrompt/scene/lastUserPrompt.md')
_SCENE_IMAGE_PROMPT_PREFILL = _load_prompt_file('imagePrompt/scene/prefill.md')
# Image Prompt - Cover Image
_COVER_IMAGE_PROMPT_SYSTEM_PROMPT = _load_prompt_file('imagePrompt/coverImage/systemPrompt.md')
_COVER_IMAGE_PROMPT_USER_PROMPT = _load_prompt_file('imagePrompt/coverImage/userPrompt.md')
_COVER_IMAGE_PROMPT_INITIAL_USER_PROMPT = _load_prompt_file('imagePrompt/coverImage/initialUserPrompt.md')
_COVER_IMAGE_PROMPT_FIRST_USER_PROMPT = _load_prompt_file('imagePrompt/coverImage/firstUserPrompt.md')
_COVER_IMAGE_PROMPT_LAST_USER_PROMPT = _load_prompt_file('imagePrompt/coverImage/lastUserPrompt.md')
_COVER_IMAGE_PROMPT_PREFILL = _load_prompt_file('imagePrompt/coverImage/prefill.md')

# Default prompts structure
# Format matches the frontend structure: {task_type: {category: {name?: content}}}
DEFAULT_PROMPTS = {
    'agent': {
        'systemPrompt': {
            'planMode': _PLAN_MODE_SYSTEM_PROMPT,
            'agentMode': _AGENT_MODE_SYSTEM_PROMPT,
            'memorySummary': _MEMORY_SUMMARY_SYSTEM_PROMPT,
        },
        'memoryPrompt': {
            'planMode': _PLAN_MODE_MEMORY_PROMPT,
            'agentMode': _AGENT_MODE_MEMORY_PROMPT,
        },
        'userPrompt': {
            'planMode': _PLAN_MODE_USER_PROMPT,
            'agentMode': _AGENT_MODE_USER_PROMPT,
            'memorySummary': _MEMORY_SUMMARY_USER_PROMPT,
        },
        'firstUserPrompt': {
            'planMode': _PLAN_MODE_FIRST_USER_PROMPT,
            'agentMode': _AGENT_MODE_FIRST_USER_PROMPT,
        },
        'lastUserPrompt': {
            'planMode': _PLAN_MODE_LAST_USER_PROMPT,
            'agentMode': _AGENT_MODE_LAST_USER_PROMPT,
        },
        'prefill': {
            'planMode': _PLAN_MODE_PREFILL,
            'agentMode': _AGENT_MODE_PREFILL,
        },
    },
    'translation': {
        'systemPrompt': {
            'object': _TRANSLATION_SYSTEM_PROMPT_OBJECT,
            'message': _TRANSLATION_SYSTEM_PROMPT_MESSAGE,
        },
        'userPrompt': {
            'object': _TRANSLATION_USER_PROMPT_OBJECT,
            'message': _TRANSLATION_USER_PROMPT_MESSAGE,
        },
        'initialUserPrompt': {
            'object': _TRANSLATION_INITIAL_USER_PROMPT_OBJECT,
        },
        'firstUserPrompt': {
            'object': _TRANSLATION_FIRST_USER_PROMPT_OBJECT,
        },
        'lastUserPrompt': {
            'object': _TRANSLATION_LAST_USER_PROMPT_OBJECT,
        },
        'prefill': {
            'object': _TRANSLATION_PREFILL_OBJECT,
            'message': _TRANSLATION_PREFILL_MESSAGE,
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
        'initialUserPrompt': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_INITIAL_USER_PROMPT,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_INITIAL_USER_PROMPT,
        },
        'firstUserPrompt': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_FIRST_USER_PROMPT,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_FIRST_USER_PROMPT,
        },
        'lastUserPrompt': {
            'manuscript': _EDIT_ASSISTANT_MANUSCRIPT_LAST_USER_PROMPT,
            'storyObject': _EDIT_ASSISTANT_STORY_OBJECT_LAST_USER_PROMPT,
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
            'coverImage': _COVER_IMAGE_PROMPT_SYSTEM_PROMPT,
        },
        'userPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_USER_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_USER_PROMPT,
            'coverImage': _COVER_IMAGE_PROMPT_USER_PROMPT,
        },
        'initialUserPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_INITIAL_USER_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_INITIAL_USER_PROMPT,
            'coverImage': _COVER_IMAGE_PROMPT_INITIAL_USER_PROMPT,
        },
        'firstUserPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_FIRST_USER_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_FIRST_USER_PROMPT,
            'coverImage': _COVER_IMAGE_PROMPT_FIRST_USER_PROMPT,
        },
        'lastUserPrompt': {
            'object': _OBJECT_IMAGE_PROMPT_LAST_USER_PROMPT,
            'scene': _SCENE_IMAGE_PROMPT_LAST_USER_PROMPT,
            'coverImage': _COVER_IMAGE_PROMPT_LAST_USER_PROMPT,
        },
        'prefill': {
            'object': _OBJECT_IMAGE_PROMPT_PREFILL,
            'scene': _SCENE_IMAGE_PROMPT_PREFILL,
            'coverImage': _COVER_IMAGE_PROMPT_PREFILL,
        },
    },
}


def get_default_prompts():
    """
    Get the default prompts dictionary.

    Returns:
        dict: Default prompts in the format {task_type: {category: {name?: content}}}
    """
    return DEFAULT_PROMPTS


# ============================================================================
# DEFAULT FRAGMENTS
# ============================================================================

FRAGMENTS_DIR = CURRENT_DIR / 'default_fragments'


def _load_all_fragments() -> dict[str, str]:
    """
    Load all fragment files under default_fragments recursively.

    Keys are stored without the `.md` extension and always use POSIX separators.

    Example:
      default_fragments/translation/functions.md -> "translation/functions"
    """
    fragments: dict[str, str] = {}

    for file_path in FRAGMENTS_DIR.rglob('*.md'):
        key = file_path.relative_to(FRAGMENTS_DIR).with_suffix('').as_posix()
        try:
            fragments[key] = file_path.read_text(encoding='utf-8')
        except FileNotFoundError:
            print(f"Warning: Fragment file not found: {file_path}")
            fragments[key] = f"# Default fragment (file not found: {key})"

    return fragments


DEFAULT_FRAGMENTS = _load_all_fragments()


def get_default_fragments():
    """
    Get the default fragments dictionary.

    Returns:
        dict: Default fragments in the format {'folder/name': content}
    """
    return DEFAULT_FRAGMENTS
