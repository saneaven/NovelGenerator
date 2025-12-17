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

## Object Type

{{ imagePrompt.objectType }}

## Object Information

{{ imagePrompt.objectInfo }}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}

{{#if (or imagePrompt.currentPrompt imagePrompt.currentPromptPositive imagePrompt.currentPromptNegative)}}
## Current Saved Prompts (for reference)

{{#if imagePrompt.currentPrompt}}
**Natural Language:** {{ imagePrompt.currentPrompt }}
{{/if}}
{{#if imagePrompt.currentPromptPositive}}
**Positive Tags:** {{ imagePrompt.currentPromptPositive }}
{{/if}}
{{#if imagePrompt.currentPromptNegative}}
**Negative Tags:** {{ imagePrompt.currentPromptNegative }}
{{/if}}

You may use these as a starting point or create something entirely new based on the user's request.
{{/if}}

---

{{#if config.isNativeOutputMode}}
Output ONLY the generated prompt text directly.
{{else}}
Call the `generate_object_image_prompt` function with your generated prompt.
{{/if}}
