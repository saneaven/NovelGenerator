{{!-- This fragment provides a list of all project objects with their IDs for use with read functions --}}
{{!-- Usage: {{prompt "common/objectIndex"}} --}}

## Available Objects Reference

Use read functions to get full content of any object listed below.

### Story Objects

{{#each project.objects}}
- [{{ this.type }}] {{ this.name }} (id: {{ this.id }})
{{/each}}

{{#if project.outline}}
### Outline & Manuscripts
<outline-structure>
{{#each project.outline.outlines}}
  <outline id="{{ this.id }}" name="{{ this.name }}">
{{#each this.acts}}
    <act id="{{ this.id }}" name="{{ this.name }}">
{{#each this.chapters}}
      <chapter id="{{ this.id }}" name="{{ this.name }}" manuscript-id="{{ this.manuscriptId }}" />
{{/each}}
    </act>
{{/each}}
  </outline>
{{/each}}
</outline-structure>
{{/if}}