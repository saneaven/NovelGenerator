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

## Current Object

{% if imagePrompt.currentObject.type %}
**Type:** {{ imagePrompt.currentObject.type }}
{% endif %}

**Name:** {{ imagePrompt.currentObject.name }}

{% if imagePrompt.currentObject.description %}
**Description:** {{ imagePrompt.currentObject.description }}
{% endif %}

{% if imagePrompt.currentObject.content %}
## Content

{{ imagePrompt.currentObject.content }}
{% endif %}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}

{% if (imagePrompt.currentObject.image_prompt or imagePrompt.currentObject.image_prompt_positive or imagePrompt.currentObject.image_prompt_negative) %}
## Current Saved Prompts (for reference)

{% if imagePrompt.currentObject.image_prompt %}
**Natural Language:** {{ imagePrompt.currentObject.image_prompt }}
{% endif %}
{% if imagePrompt.currentObject.image_prompt_positive %}
**Positive Tags:** {{ imagePrompt.currentObject.image_prompt_positive }}
{% endif %}
{% if imagePrompt.currentObject.image_prompt_negative %}
**Negative Tags:** {{ imagePrompt.currentObject.image_prompt_negative }}
{% endif %}

You may use these as a starting point or create something entirely new based on the user's request.
{% endif %}

---

{% if (config.outputMode == "raw_output") %}
Output ONLY the generated prompt text directly.
{% else %}
Call the `generate_object_image_prompt` function with your generated prompt.
{% endif %}
