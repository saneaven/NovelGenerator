# Agent Message to Translate

Translate the message below from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{{#if input.userMessage}}
## Additional Instructions
{{ input.userMessage }}
{{/if}}

## Message
Content (translate this):
{{#each translation.messages}}
{{ this.content }}
{{/each}}

## Requirements
- Output ONLY the translated text directly.
- Do NOT wrap in JSON, tool calls, or any markup.
- Do NOT translate any tool-call/json snippets; keep them untouched.
- Do not add extra commentary - just the pure translated content.
