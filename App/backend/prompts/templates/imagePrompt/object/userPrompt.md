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

## Object Type

{{ variable.objectType | capitalize }}

## Object Information

{{ variable.objectInfo }}

{% if state.hasUserInput %}
## User Request

{{ variable.userInput }}
{% endif %}

{% if state.hasCurrentPrompt %}
## Current Saved Prompts (for reference)

{% if variable.currentPrompt %}
**Natural Language:** {{ variable.currentPrompt }}
{% endif %}
{% if variable.currentPromptPositive %}
**Positive Tags:** {{ variable.currentPromptPositive }}
{% endif %}
{% if variable.currentPromptNegative %}
**Negative Tags:** {{ variable.currentPromptNegative }}
{% endif %}

You may use these as a starting point or create something entirely new based on the user's request.
{% endif %}

---

Call the `generate_object_image_prompt` function with your generated prompt.
