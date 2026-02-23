"""
Default prompt content for the Novel Buds application.

This module contains default ScenarioDocument prompts and default fragments that are seeded
when creating a new prompt preset.

Templates are loaded from:
- App/backend/prompts/templates/

Format: {task_type: {task_subtype: ScenarioDocument}}
"""

from pathlib import Path
import uuid

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
# Memory - Summary
_MEMORY_SUMMARY_SYSTEM_PROMPT = _load_prompt_file('memory/summary/systemPrompt.md')
_MEMORY_SUMMARY_USER_PROMPT = _load_prompt_file('memory/summary/userPrompt.md')
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

def _make_static_block(*, order: int, subtype: str, role: str, template: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "block_order": int(order),
        "enabled": True,
        "type": "staticPrompt",
        "staticPrompt": {"subtype": subtype, "role": role, "template": template},
    }


def _make_range_block(*, order: int, start_index: int, end_index: int, user_template: str, assistant_template: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "block_order": int(order),
        "enabled": True,
        "type": "rangeMapping",
        "rangeMapping": {
            "start_index": int(start_index),
            "end_index": int(end_index),
            "user_template": user_template,
            "assistant_template": assistant_template,
        },
    }


def get_default_scenarios() -> dict:
    """Get the default ScenarioDocument templates for seeding new presets."""
    identity_assistant = "{{input.agentMessage}}"

    return {
        "agent": {
            "planMode": {
                "system_template": _PLAN_MODE_SYSTEM_PROMPT,
                "blocks": [
                    _make_static_block(order=0, subtype="memory", role="user", template=_PLAN_MODE_MEMORY_PROMPT),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=-2,
                        user_template=_PLAN_MODE_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=0,
                        end_index=0,
                        user_template=_PLAN_MODE_FIRST_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=3,
                        start_index=-1,
                        end_index=-1,
                        user_template=_PLAN_MODE_LAST_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=4, subtype="prefill", role="assistant", template=_PLAN_MODE_PREFILL),
                ],
            },
            "agentMode": {
                "system_template": _AGENT_MODE_SYSTEM_PROMPT,
                "blocks": [
                    _make_static_block(order=0, subtype="memory", role="user", template=_AGENT_MODE_MEMORY_PROMPT),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=-2,
                        user_template=_AGENT_MODE_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=0,
                        end_index=0,
                        user_template=_AGENT_MODE_FIRST_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=3,
                        start_index=-1,
                        end_index=-1,
                        user_template=_AGENT_MODE_LAST_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=4, subtype="prefill", role="assistant", template=_AGENT_MODE_PREFILL),
                ],
            },
        },
        "memory": {
            "summary": {
                "system_template": _MEMORY_SUMMARY_SYSTEM_PROMPT,
                "blocks": [
                    _make_static_block(order=0, subtype="normal", role="user", template=_MEMORY_SUMMARY_USER_PROMPT),
                ],
            },
        },
        "translation": {
            "object": {
                "system_template": _TRANSLATION_SYSTEM_PROMPT_OBJECT,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-2,
                        user_template=_TRANSLATION_USER_PROMPT_OBJECT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=0,
                        user_template=_TRANSLATION_INITIAL_USER_PROMPT_OBJECT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=1,
                        end_index=-1,
                        user_template=_TRANSLATION_LAST_USER_PROMPT_OBJECT or _TRANSLATION_USER_PROMPT_OBJECT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=3, subtype="prefill", role="assistant", template=_TRANSLATION_PREFILL_OBJECT),
                ],
            },
            "message": {
                "system_template": _TRANSLATION_SYSTEM_PROMPT_MESSAGE,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-1,
                        user_template=_TRANSLATION_USER_PROMPT_MESSAGE,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=1, subtype="prefill", role="assistant", template=_TRANSLATION_PREFILL_MESSAGE),
                ],
            },
        },
        "editAssistant": {
            "manuscript": {
                "system_template": _EDIT_ASSISTANT_MANUSCRIPT_SYSTEM_PROMPT,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-2,
                        user_template=_EDIT_ASSISTANT_MANUSCRIPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=0,
                        user_template=_EDIT_ASSISTANT_MANUSCRIPT_INITIAL_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=1,
                        end_index=-1,
                        user_template=_EDIT_ASSISTANT_MANUSCRIPT_LAST_USER_PROMPT or _EDIT_ASSISTANT_MANUSCRIPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=3, subtype="prefill", role="assistant", template=_EDIT_ASSISTANT_MANUSCRIPT_PREFILL),
                ],
            },
            "storyObject": {
                "system_template": _EDIT_ASSISTANT_STORY_OBJECT_SYSTEM_PROMPT,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-2,
                        user_template=_EDIT_ASSISTANT_STORY_OBJECT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=0,
                        user_template=_EDIT_ASSISTANT_STORY_OBJECT_INITIAL_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=1,
                        end_index=-1,
                        user_template=_EDIT_ASSISTANT_STORY_OBJECT_LAST_USER_PROMPT or _EDIT_ASSISTANT_STORY_OBJECT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=3, subtype="prefill", role="assistant", template=_EDIT_ASSISTANT_STORY_OBJECT_PREFILL),
                ],
            },
        },
        "imagePrompt": {
            "object": {
                "system_template": _OBJECT_IMAGE_PROMPT_SYSTEM_PROMPT,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-2,
                        user_template=_OBJECT_IMAGE_PROMPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=0,
                        user_template=_OBJECT_IMAGE_PROMPT_INITIAL_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=1,
                        end_index=-1,
                        user_template=_OBJECT_IMAGE_PROMPT_LAST_USER_PROMPT or _OBJECT_IMAGE_PROMPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=3, subtype="prefill", role="assistant", template=_OBJECT_IMAGE_PROMPT_PREFILL),
                ],
            },
            "scene": {
                "system_template": _SCENE_IMAGE_PROMPT_SYSTEM_PROMPT,
                "blocks": [
                    _make_range_block(
                        order=0,
                        start_index=0,
                        end_index=-2,
                        user_template=_SCENE_IMAGE_PROMPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=1,
                        start_index=0,
                        end_index=0,
                        user_template=_SCENE_IMAGE_PROMPT_INITIAL_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_range_block(
                        order=2,
                        start_index=1,
                        end_index=-1,
                        user_template=_SCENE_IMAGE_PROMPT_LAST_USER_PROMPT or _SCENE_IMAGE_PROMPT_USER_PROMPT,
                        assistant_template=identity_assistant,
                    ),
                    _make_static_block(order=3, subtype="prefill", role="assistant", template=_SCENE_IMAGE_PROMPT_PREFILL),
                ],
            },
        },
    }


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
