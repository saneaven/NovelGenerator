# Story Object Context

Category: **{{ variable.categoryName }}**

{% if variable.targetId %}
Target ID: {{ variable.targetId }}
{% endif %}

{% if context.contextData %}
## Project Context

{{ context.contextData | json }}
{% endif %}

## Current Data

{{ context.currentData | json }}

{% if variable.userRequest %}
## User Request

{{ variable.userRequest }}
{% endif %}