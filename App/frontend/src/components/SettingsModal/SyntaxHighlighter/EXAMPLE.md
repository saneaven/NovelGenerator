# Example Prompt Template

This demonstrates all supported syntax highlighting:

## Template Variables

Access data with double brackets:
- Variable: {{ config.mainLanguage }}
- Nested: {{ project.basicInfo.title }}

## Conditional Logic

{% if config.thinking_mode == "custom" %}
Use thinking blocks for analysis
{% endif %}

## Loops

{% for obj in project.storyEntities|filter_by_type("story_entity") %}
- {{ obj.name }}: {{ obj.description }}
{% endfor %}

## Macros And Tree Rendering

{% macro render_story_entity_tree(nodes) -%}
{% for node in nodes %}
{% if node.nodeType == "folder" %}
## Folder: {{ node.name }}
{{ render_story_entity_tree(node.children) }}
{% elif node.nodeType == "story_entity" %}
- {{ node.entity.kind }}: {{ node.entity.name }}
{% endif %}
{% endfor %}
{%- endmacro %}

{{ render_story_entity_tree(project.storyEntityTree) }}

## Fragment Inclusion

{% include "fragment:common/basicInfo" %}
{% include "fragment:common/guidelines" %}
{% with selectedIds = agent.contextObjectIds %}{% include "fragment:common/objectContext" %}{% endwith %}
{% include "fragment:common/objectIndex" %}

## Comments

{# This comment will not appear in the rendered output #}

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

{% if config.thinking_mode != "off" %}
<thinking>
Before responding:
1. Analyze **{{ project.basicInfo.title }}**
2. Review the outline structure
3. Plan the response
</thinking>
{% endif %}

{% for outline in project.outline.outlines %}
### {{ outline.name }}
{{ outline.description }}
{% endfor %}
