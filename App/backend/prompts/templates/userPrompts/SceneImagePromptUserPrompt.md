## Prompt Format Required

{% if state.isNaturalPrompt %}
Generate a **natural language prompt** (flowing descriptive sentences for DALL-E, Gemini, Grok, etc.)
{% endif %}
{% if state.isPositivePrompt %}
Generate **positive tags** (comma-separated keywords for NovelAI describing what TO include)
{% endif %}
{% if state.isNegativePrompt %}
Generate **negative tags** (comma-separated keywords for NovelAI describing what to AVOID)
{% endif %}

## Scene Context

The image will be inserted at the cursor position in the novel. Here is the surrounding text:

### Text Before Cursor
{{ variable.scenePreContext }}

### Text After Cursor
{{ variable.scenePostContext }}

{% if state.hasUserRequest %}
## User Request

{{ variable.userRequest }}
{% endif %}

{% if state.hasAvailableObjects %}
## Available Story Objects

Review these objects and select the ones relevant to this scene. Include their IDs in your response.

{% for obj in context.availableObjects %}
### {{ obj.type | capitalize }}: {{ obj.name }}
- **ID**: `{{ obj.id }}`
{% if obj.description %}
- **Description**: {{ obj.description }}
{% endif %}

{% endfor %}
{% endif %}

---

Call the `generate_scene_image_prompt` function with:
1. Your generated prompt
2. The IDs of relevant objects from the list above (as `reference_object_ids` array)
