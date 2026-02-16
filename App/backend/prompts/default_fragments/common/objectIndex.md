{# This fragment provides a list of all project objects with their IDs for use with read functions #}
{# Usage: {% include "fragment:common/objectIndex" %} #}

## Available Objects Reference

Use read functions to get full content of any object listed below.

### Story Objects

{% for this in project.objects %}
- [{{ this.type }}] {{ this.name }}: {{ this.description }} (id: {{ this.id }})
{% endfor %}

{% if project.outline %}
### Outline & Manuscripts
<outline-structure>
{% for this in project.outline.outlines %}
  <outline id="{{ this.id }}" name="{{ this.name }}">
{% for this in this.acts %}
    <act id="{{ this.id }}" name="{{ this.name }}">
{% for this in this.chapters %}
      <chapter id="{{ this.id }}" name="{{ this.name }}" manuscript-id="{{ this.manuscriptId }}" />
{% endfor %}
    </act>
{% endfor %}
  </outline>
{% endfor %}
</outline-structure>
{% endif %}
