## Prompt Format Required

{{#if (eq imagePrompt.promptMode "natural")}}
Generate a **natural language prompt** (flowing descriptive sentences for DALL-E, Gemini, Grok, etc.)
{{/if}}
{{#if (eq imagePrompt.promptMode "positive")}}
Generate **positive tags** (comma-separated keywords for NovelAI describing what TO include)
{{/if}}
{{#if (eq imagePrompt.promptMode "negative")}}
Generate **negative tags** (comma-separated keywords for NovelAI describing what to AVOID)
{{/if}}

## Current Object

{{#if imagePrompt.currentObject.type}}
**Type:** {{ imagePrompt.currentObject.type }}
{{/if}}

**Name:** {{ imagePrompt.currentObject.name }}

{{#if imagePrompt.currentObject.description}}
**Description:** {{ imagePrompt.currentObject.description }}
{{/if}}

{{#if imagePrompt.currentObject.content}}
## Content

{{ imagePrompt.currentObject.content }}
{{/if}}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}

{{#if (or imagePrompt.currentObject.image_prompt imagePrompt.currentObject.image_prompt_positive imagePrompt.currentObject.image_prompt_negative)}}
## Current Saved Prompts (for reference)

{{#if imagePrompt.currentObject.image_prompt}}
**Natural Language:** {{ imagePrompt.currentObject.image_prompt }}
{{/if}}
{{#if imagePrompt.currentObject.image_prompt_positive}}
**Positive Tags:** {{ imagePrompt.currentObject.image_prompt_positive }}
{{/if}}
{{#if imagePrompt.currentObject.image_prompt_negative}}
**Negative Tags:** {{ imagePrompt.currentObject.image_prompt_negative }}
{{/if}}

You may use these as a starting point or create something entirely new based on the user's request.
{{/if}}

---

{{#if (eq config.outputMode "raw_output")}}
Output ONLY the generated prompt text directly.
{{else}}
Call the `generate_object_image_prompt` function with your generated prompt.
{{/if}}
