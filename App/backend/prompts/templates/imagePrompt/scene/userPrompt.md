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

## Scene Context

The image will be inserted at the cursor position in the novel. Here is the surrounding text:

### Text Before Cursor
{{ imagePrompt.scenePreContext }}

### Text After Cursor
{{ imagePrompt.scenePostContext }}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}

{{#if (hasItems imagePrompt.selectedObjectIds)}}
## Story Object Context

The following objects are relevant to this scene. Use their descriptions and saved image prompts (if available) to inform your generated prompt:

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

Generate an image prompt based on the scene context above.
{{#if (hasItems imagePrompt.selectedObjectIds)}}
Use the saved image prompts as reference for visual details when available.
{{/if}}
