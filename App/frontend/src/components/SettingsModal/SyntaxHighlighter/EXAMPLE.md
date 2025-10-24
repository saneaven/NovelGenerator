# Example Prompt Template

This demonstrates all supported syntax highlighting:

## Template Variables

Access data with double brackets:
- Variable: {{var::chapterName}}
- Context: {{context::storyData}}

## Conditional Logic

```
{{#if::thinking}}
Use thinking blocks for analysis
{{/if}}
```

## XML Tags

<thinking>
Analyze the user's request before responding.
</thinking>

<user_input>
The user's message goes here.
</user_input>

## Markdown Features

### Headers
# H1 Header
## H2 Header
### H3 Header

### Lists
- Bullet item 1
- Bullet item 2
  - Nested item
1. Numbered item
2. Another item

### Text Styling
**Bold text** for emphasis
*Italic text* for subtle emphasis
`Inline code` for technical terms

### Code Blocks
```
function example() {
  return "Code blocks are highlighted";
}
```

## Complete Example

{{#if::thinking}}
<thinking>
Before responding:
1. Analyze **{{var::chapterName}}**
2. Review context: {{context::storyData}}
3. Plan the response
</thinking>
{{/if}}

The chapter **{{var::chapterName}}** should be:
- Consistent with `{{context::worldBuilding}}`
- Written in *{{var::language}}*
- Following the style guide
