## Project Context

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{% if (((project.objects|filter_by_type("character")))|length > 0) %}
### Characters

{% for this in (project.objects|filter_by_type("character")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((project.objects|filter_by_type("organization")))|length > 0) %}
### Organizations

{% for this in (project.objects|filter_by_type("organization")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((project.objects|filter_by_type("location")))|length > 0) %}
### Locations

{% for this in (project.objects|filter_by_type("location")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((project.objects|filter_by_type("lorebook")))|length > 0) %}
### Lorebook

{% for this in (project.objects|filter_by_type("lorebook")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if project.outline %}
{% for this in project.outline.outlines %}
### Story Outline - {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% if ((this.acts)|length > 0) %}
{% for this in this.acts %}
#### Act: {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% if ((this.chapters)|length > 0) %}
**Chapters:**
{% for this in this.chapters %}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.content }}
{% endfor %}
{% endif %}

{% endfor %}
{% endif %}
{% endfor %}
{% endif %}
