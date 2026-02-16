## Project Context

{# This fragment expects objectIds to be passed as the first positional parameter #}
{# Usage: {% with params = [someContext.objectIds] %}{% include "fragment:common/projectContext/filtered" %}{% endwith %} #}

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{% if ((params[0])|length > 0) %}
{% with selectedObjects = (project.objects|filter_by_ids(params[0])) %}

{% if (((selectedObjects|filter_by_type("character")))|length > 0) %}
### Characters

{% for this in (selectedObjects|filter_by_type("character")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((selectedObjects|filter_by_type("organization")))|length > 0) %}
### Organizations

{% for this in (selectedObjects|filter_by_type("organization")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((selectedObjects|filter_by_type("location")))|length > 0) %}
### Locations

{% for this in (selectedObjects|filter_by_type("location")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% if (((selectedObjects|filter_by_type("lorebook")))|length > 0) %}
### Lorebook

{% for this in (selectedObjects|filter_by_type("lorebook")) %}
#### {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% endfor %}
{% endif %}

{% endwith %}

{% if project.outline %}
{% with selectedOutlines = (project.outline.outlines|filter_by_ids(params[0])) %}
{% for this in selectedOutlines %}
### Story Outline - {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% with selectedActs = (this.acts|filter_by_ids(params[0])) %}
{% if ((selectedActs)|length > 0) %}
{% for this in selectedActs %}
#### Act: {{ this.name }} (id: {{ this.id }})

{{ this.content }}

{% with selectedChapters = (this.chapters|filter_by_ids(params[0])) %}
{% if ((selectedChapters)|length > 0) %}
**Chapters:**
{% for this in selectedChapters %}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.content }}
{% endfor %}
{% endif %}
{% endwith %}

{% endfor %}
{% endif %}
{% endwith %}
{% endfor %}
{% endwith %}
{% endif %}

{% with selectedManuscripts = (project.manuscripts|filter_by_ids(params[0])) %}
{% if ((selectedManuscripts)|length > 0) %}
### Reference Novel Content

{% for this in selectedManuscripts %}
#### {{ this.chapterName }} (id: {{ this.id }})

{{ this.content }}

---
{% endfor %}
{% endif %}
{% endwith %}

{% endif %}
