{{#with (lookup project.languages translation.targetLanguage)}}
## Reference Context (Already Translated to {{ ../translation.targetLanguage }})

Use the following already-translated content as reference to maintain consistent terminology, naming, and style:

{{#if this.basicInfo}}
### Story Info
- **Title**: {{ this.basicInfo.title }}
- **Logline**: {{ this.basicInfo.logline }}
- **Genre**: {{ this.basicInfo.genre }}
{{/if}}

{{#if (hasItems (filterByType this.objects "character"))}}
### Characters
{{#each (filterByType this.objects "character")}}
- **{{ this.name }}**: {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType this.objects "organization"))}}
### Organizations
{{#each (filterByType this.objects "organization")}}
- **{{ this.name }}**: {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType this.objects "location"))}}
### Locations
{{#each (filterByType this.objects "location")}}
- **{{ this.name }}**: {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType this.objects "lorebook"))}}
### World Details
{{#each (filterByType this.objects "lorebook")}}
- **{{ this.name }}**: {{ this.description }}
{{/each}}
{{/if}}

**Important**: Use the exact names and terminology from this reference context when translating.
{{/with}}
