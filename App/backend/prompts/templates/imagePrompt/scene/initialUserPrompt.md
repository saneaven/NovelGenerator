## Prompt Format Required

{% if (imagePrompt.promptMode == "natural") %}
Generate a **natural language prompt** (flowing descriptive sentences for DALL-E, Gemini, Grok, etc.)
{% endif %}
{% if (imagePrompt.promptMode == "positive") %}
Generate **positive tags** (comma-separated keywords for NovelAI describing what TO include)
{% endif %}
{% if (imagePrompt.promptMode == "negative") %}
Generate **negative tags** (comma-separated keywords for NovelAI describing what to AVOID)
{% endif %}

## Scene Context

The image will be inserted at the cursor position in the novel. Here is the surrounding text:

### Text Before Cursor
{{ imagePrompt.scenePreContext }}

### Text After Cursor
{{ imagePrompt.scenePostContext }}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}

{% if ((imagePrompt.selectedObjectIds)|length > 0) %}
## Story Object Context

The following objects are relevant to this scene. Use their content and saved image prompts (if available) to inform your generated prompt:

{% with selectedObjects = (project.objects|filter_by_ids(imagePrompt.selectedObjectIds)) %}
{% for this in selectedObjects %}
### {{ this.type }}: {{ this.name }}
{{ this.content }}
{% if this.imagePrompt %}
**Saved Image Prompt:** {{ this.imagePrompt }}
{% endif %}

{% endfor %}
{% endwith %}
{% endif %}

---

Generate an image prompt based on the scene context above.
{% if ((imagePrompt.selectedObjectIds)|length > 0) %}
Use the saved image prompts as reference for visual details when available.
{% endif %}
