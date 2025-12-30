{{#if (hasItems input.functionResults)}}
# Function Call Results

Based on your previous suggestions, the user made the following decisions:

{{#each input.functionResults}}
{{#if this.success}}
- {{ this.functionName }}: APPLIED - {{ this.resultMessage }}
{{else}}
{{#if this.isRejected}}
- {{ this.functionName }}: REJECTED BY USER - User chose not to apply this change
{{else}}
- {{ this.functionName }}: FAILED - {{ this.resultMessage }}
{{/if}}
{{/if}}
{{/each}}
{{/if}}

# Current Project Status

{{prompt "common/projectContext/filtered" chat.contextObjectIds}}

# Language Instruction
You must use {{ config.mainLanguage }} only.

# User Message

{{ input.userMessage }}
