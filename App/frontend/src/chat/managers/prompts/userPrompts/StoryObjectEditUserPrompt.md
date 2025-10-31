# Story Object Context

Category: **{{var::categoryName}}**

{{#if::targetId}}
Target ID: {{var::targetId}}
{{/if}}

{{#if::contextData}}
## Project Context

{{context::contextData}}
{{/if}}

## Current Data

{{context::currentData}}

{{#if::userRequest}}
## User Request

{{context::userRequest}}
{{/if}}
