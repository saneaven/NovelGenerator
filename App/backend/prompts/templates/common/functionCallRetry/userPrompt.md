{{! Function Call Retry Template }}
{{! This template is rendered when retrying failed function calls }}
{{! Available variables: retry.successResults, retry.parsingFailures, retry.validationFailures, retry.applicationFailures }}

## RETRY CONTEXT - Previous Request Had Failures

{{#if retry.successResults.length}}
## Previously Successful
The following function calls succeeded and should NOT be repeated:
{{#each retry.successResults}}
- **{{functionName}}**: {{resultMessage}}
  ```json
  {{json arguments}}
  ```
{{/each}}
{{/if}}

{{#if retry.parsingFailures.length}}
## Parsing Errors
The following function calls had invalid JSON:
{{#each retry.parsingFailures}}
- **{{functionName}}**: {{error}}
{{/each}}
Please ensure your function call arguments are valid JSON.
{{/if}}

{{#if retry.validationFailures.length}}
## Validation Errors
The following function calls failed schema validation:
{{#each retry.validationFailures}}
- **{{functionName}}**: {{error}}
  Attempted arguments:
  ```json
  {{json arguments}}
  ```
{{/each}}
Please check required fields and data types.
{{/if}}

{{#if retry.applicationFailures.length}}
## Application Errors
{{#each retry.applicationFailures}}
- **{{functionName}}**: {{error}}
  Attempted arguments:
  ```json
  {{json arguments}}
  ```
{{#if patchFailures}}
  Patch failures:
{{#each patchFailures}}
    - {{fieldName}} ({{objectType}}:{{objectId}}): {{error}}
{{/each}}
  **You MUST use replace_* functions instead of patch_* for these fields.**
{{/if}}
{{/each}}
{{/if}}

Please retry ONLY the failed operations, taking into account the errors above.
