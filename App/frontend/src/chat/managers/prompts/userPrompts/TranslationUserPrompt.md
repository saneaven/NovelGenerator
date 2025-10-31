# Translation Request

Translate the provided material from **{{var::sourceLanguage}}** to **{{var::targetLanguage}}** for the **{{var::dataTypeName}}** dataset.

{{#if::previousVersionContext}}
## Previous Version Context

Use the prior {{var::targetLanguage}} version to maintain continuity:

{{context::previousVersionContext}}
{{/if}}

{{#if::previousTranslationReference}}
## Previous Translation Reference

Keep terminology and tone consistent with the earlier translation:

{{context::previousTranslationReference}}
{{/if}}

{{#if::userInstructions}}
## Additional Instructions

{{context::userInstructions}}
{{/if}}

## Source Payload ({{var::sourceLanguage}})

{{context::sourceData}}
