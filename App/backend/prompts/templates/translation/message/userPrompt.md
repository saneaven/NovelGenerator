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
{{#if config.isRawOutputMode}}
- Output ONLY the translated text directly.
- Do NOT wrap in JSON, function calls, or any markup.
- Do NOT translate any function-call/json snippets; keep them untouched.
- Do not add extra commentary - just the pure translated content.
{{else}}
- Return the translation via `set_message_translation`.
- Only include translated `content` in the function call.
- Do NOT translate any function-call/json snippets; keep them untouched.
- Do not add extra commentary outside the function call.
{{/if}}
