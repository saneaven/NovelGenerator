{% with this = (project.contentByLang.get(translation.targetLanguage)) %}
{% if this %}
## Reference Context (Already Translated to {{ translation.targetLanguage }})

Use the following already-translated content as reference to maintain consistent terminology, naming, and style:

{% if this.basicInfo %}
### Story Info
- **Title**: {{ this.basicInfo.title }}
- **Logline**: {{ this.basicInfo.logline }}
- **Genre**: {{ this.basicInfo.genre }}
{% endif %}

{% if (((this.objects|filter_by_type("character")))|length > 0) %}
### Characters
{% for this in (this.objects|filter_by_type("character")) %}
- **{{ this.name }}**: {{ this.content }}
{% endfor %}
{% endif %}

{% if (((this.objects|filter_by_type("organization")))|length > 0) %}
### Organizations
{% for this in (this.objects|filter_by_type("organization")) %}
- **{{ this.name }}**: {{ this.content }}
{% endfor %}
{% endif %}

{% if (((this.objects|filter_by_type("location")))|length > 0) %}
### Locations
{% for this in (this.objects|filter_by_type("location")) %}
- **{{ this.name }}**: {{ this.content }}
{% endfor %}
{% endif %}

{% if (((this.objects|filter_by_type("lorebook")))|length > 0) %}
### World Details
{% for this in (this.objects|filter_by_type("lorebook")) %}
- **{{ this.name }}**: {{ this.content }}
{% endfor %}
{% endif %}

**Important**: Use the exact names and terminology from this reference context when translating.
{% endif %}
{% endwith %}
