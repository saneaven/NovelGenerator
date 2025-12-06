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

{% if state.hasUserInput %}
## User Request

{{ variable.userInput }}
{% endif %}

{% if state.hasSelectedObjects %}
## Story Object Context

The following objects are relevant to this scene. Use their descriptions and saved image prompts (if available) to inform your generated prompt:

{% for obj in context.selectedObjects %}
### {{ obj.type | capitalize }}: {{ obj.name }}
{{ obj.description }}
{% if obj.imagePrompt %}
**Saved Image Prompt:** {{ obj.imagePrompt }}
{% endif %}

{% endfor %}
{% endif %}

---

Generate an image prompt based on the scene context above.
{% if state.hasSelectedObjects %}
Use the saved image prompts as reference for visual details when available.
{% endif %}
