# Story Object Edit Request

{% with objectIds = editAssistant.storyObject.contextIds %}
{% include "fragment:common/projectContext/filtered" %}
{% endwith %}

## Target Objects to Edit

{% if ((editAssistant.storyObject.targetIds)|length > 0) %}
{% with targetIds = editAssistant.storyObject.targetIds %}

{% for this in (project.objects|filter_by_ids(targetIds)) %}
### {{ this.type }}: {{ this.name }} (ID: {{ this.id }})

{{ this.content }}

{% endfor %}

{% if project.outline %}
{% for outline in project.outline.outlines %}
{% if (outline.id in targetIds) %}
### Outline: {{ outline.name }} (ID: {{ outline.id }})

{{ outline.content }}

{% endif %}

{% for act in (outline.acts|filter_by_ids(targetIds)) %}
### Act: {{ act.name }} (ID: {{ act.id }}, Outline: {{ outline.name }})

{{ act.content }}

{% endfor %}

{% for act in outline.acts %}
{% for chapter in (act.chapters|filter_by_ids(targetIds)) %}
### Chapter: {{ chapter.name }} (ID: {{ chapter.id }}, Act: {{ act.name }}, Outline: {{ outline.name }})

{{ chapter.content }}

{% endfor %}
{% endfor %}

{% endfor %}
{% endif %}

{% endwith %}
{% endif %}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}
