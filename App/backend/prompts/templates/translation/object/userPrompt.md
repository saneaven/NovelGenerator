# Translation Request

Translate the following content from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{{#if input.userMessage}}
## Additional Instructions

{{ input.userMessage }}
{{/if}}

## Content to Translate ({{ translation.sourceLanguage }})

{{prompt "common/projectContext/filtered" translation.objectIds}}

{{#if (hasItems translation.currentTranslatedContents)}}
## Current Translations ({{ translation.targetLanguage }})

Review these existing translations to decide whether to use `set_*` (full rewrite) or `patch_*` (minor fixes):

{{#each translation.currentTranslatedContents}}
### {{ this.type }}: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.translatedContent }}

{{/each}}
{{/if}}

{{#if (hasItems translation.contextObjectIds)}}
## Translation Context ({{ translation.targetLanguage }}) - Reference Only

Use these previously translated items for terminology consistency (do not re-translate):

{{prompt "translation/filteredContext" translation.targetLanguage translation.contextObjectIds}}
{{/if}}

## Instructions

**You MUST process ALL content above** - do not skip any items.

For each item:
1. Check if there is an existing translation in "Current Translations" section
2. If NO existing translation → use `set_*` function
3. If existing translation needs FULL rewrite → use `set_*` function
4. If existing translation needs only MINOR fixes → use `patch_*` function

{{#if config.isNativeOutputMode}}
Output your translations as a JSON array with a `function` field for each item.

Example:
```json
[
  {"function": "set_object_translation", "id": "char-1", "type": "character", "name": "...", "description": "..."},
  {"function": "patch_object_translation", "id": "char-2", "type": "character", "replacements": [{"field": "name", "old": "...", "new": "..."}]}
]
```
{{else}}
Make appropriate function calls (one per item):
- `set_*` functions for new translations or full rewrites
- `patch_*` functions for minor corrections
{{/if}}
