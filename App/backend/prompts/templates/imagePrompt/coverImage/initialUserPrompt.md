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

## Novel Information

**Title:** {{ imagePrompt.coverImage.title }}

**Genre:** {{ imagePrompt.coverImage.genre }}

**Logline:** {{ imagePrompt.coverImage.logline }}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}

{% if imagePrompt.currentObject.image_prompt %}
## Current Image Prompt

The following prompt already exists. Use it as reference or build upon it:

{{ imagePrompt.currentObject.image_prompt }}
{% endif %}

{% if imagePrompt.currentObject.image_prompt_positive %}
## Current Positive Tags

{{ imagePrompt.currentObject.image_prompt_positive }}
{% endif %}

{% if imagePrompt.currentObject.image_prompt_negative %}
## Current Negative Tags

{{ imagePrompt.currentObject.image_prompt_negative }}
{% endif %}

{% if ((imagePrompt.selectedObjectIds)|length > 0) %}
## Story Object Context

The following objects can inform the cover design. Use their descriptions and saved image prompts (if available):

{% with selectedObjects = (project.objects|filter_by_ids(imagePrompt.selectedObjectIds)) %}
{% for this in selectedObjects %}
### {{ this.type }}: {{ this.name }}
{{ this.description }}
{% if this.imagePrompt %}
**Saved Image Prompt:** {{ this.imagePrompt }}
{% endif %}

{% endfor %}
{% endwith %}
{% endif %}

---

Generate a book cover image prompt that captures the essence of this novel.
{% if ((imagePrompt.selectedObjectIds)|length > 0) %}
Incorporate visual elements from the provided story objects as appropriate.
{% endif %}
