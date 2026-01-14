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

## Novel Information

**Title:** {{ imagePrompt.coverImage.title }}

**Genre:** {{ imagePrompt.coverImage.genre }}

**Logline:** {{ imagePrompt.coverImage.logline }}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}

{{#if imagePrompt.currentPrompt}}
## Current Image Prompt

The following prompt already exists. Use it as reference or build upon it:

{{ imagePrompt.currentPrompt }}
{{/if}}

{{#if imagePrompt.currentPromptPositive}}
## Current Positive Tags

{{ imagePrompt.currentPromptPositive }}
{{/if}}

{{#if imagePrompt.currentPromptNegative}}
## Current Negative Tags

{{ imagePrompt.currentPromptNegative }}
{{/if}}

{{#if (hasItems imagePrompt.selectedObjectIds)}}
## Story Object Context

The following objects can inform the cover design. Use their descriptions and saved image prompts (if available):

{{#with (filterByIds project.objects imagePrompt.selectedObjectIds) as |selectedObjects|}}
{{#each selectedObjects}}
### {{ this.type }}: {{ this.name }}
{{ this.description }}
{{#if this.imagePrompt}}
**Saved Image Prompt:** {{ this.imagePrompt }}
{{/if}}

{{/each}}
{{/with}}
{{/if}}

---

Generate a book cover image prompt that captures the essence of this novel.
{{#if (hasItems imagePrompt.selectedObjectIds)}}
Incorporate visual elements from the provided story objects as appropriate.
{{/if}}
