# Translation Request

Translate the following content from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{{#if (hasItems translation.currentTranslatedContents)}}
## Preview Translations ({{ translation.targetLanguage }})

Review these existing translations to decide whether to use `replace_*` (full rewrite) or `patch_*` (minor fixes):

<current>
{{#each translation.currentTranslatedContents}}
### {{ this.type }}: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.translatedContent }}

{{/each}}
</current>
{{/if}}

## Content to Translate

{{prompt "translation/filteredContext" translation.sourceLanguage translation.objectIds}}

{{#if input.userMessage}}
## Additional Instructions

{{ input.userMessage }}
{{/if}}
