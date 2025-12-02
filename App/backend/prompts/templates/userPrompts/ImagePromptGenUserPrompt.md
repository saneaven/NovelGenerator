## Prompt Format Required

{% if state.isNaturalPrompt %}
Generate a **natural language prompt** (flowing descriptive sentences for DALL-E, Gemini, Grok, etc.)
{% endif %}
{% if state.isPositivePrompt %}
Generate **positive tags** (comma-separated keywords for NovelAI/Stable Diffusion describing what TO include)
{% endif %}
{% if state.isNegativePrompt %}
Generate **negative tags** (comma-separated keywords for NovelAI/Stable Diffusion describing what to AVOID)
{% endif %}

{% if state.hasUserRequest %}
## User Request

{{ variable.userRequest }}
{% endif %}

{% if state.isCharacterRequest %}
## Character Reference

{{ variable.characterInfo }}
{% endif %}

{% if state.isLocationRequest %}
## Location Reference

{{ variable.locationInfo }}
{% endif %}

{% if state.isOrganizationRequest %}
## Organization Reference

{{ variable.organizationInfo }}
{% endif %}

{% if state.isLorebookRequest %}
## Lorebook Reference

{{ variable.lorebookInfo }}
{% endif %}

{% if state.isSceneRequest %}
## Scene Context

{% if variable.scenePreContext %}
### Before the Scene
{{ variable.scenePreContext }}
{% endif %}

{% if variable.scenePostContext %}
### After the Scene
{{ variable.scenePostContext }}
{% endif %}
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

Generate the prompt now.
