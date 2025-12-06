# Translation Request

Translate the following **{{ variable.objectCount }}** story objects from **{{ variable.sourceLanguage }}** to **{{ variable.targetLanguage }}**.

{% if variable.userInput %}
## Additional Instructions

{{ variable.userInput }}
{% endif %}

## Objects to Translate ({{ variable.sourceLanguage }})

{{ context.objectsArray | json }}

## Critical Instructions

**You MUST translate ALL {{ variable.objectCount }} objects** - do not skip any objects.

{% if state.isNativeOutput %}
Output your translations as a JSON array with **{{ variable.objectCount }} items**.

Requirements:
- Use the `objectId` from the source as the `id` field in your JSON output
- Maintain consistency in terminology, character names, and style across all objects
- Include the appropriate translated fields based on object type:
  - For basic_info: id, title, logline, genre
  - For manuscript: id, content
  - For all other types: id, name, description

Example output format:
```json
[
  {"id": "object-id-1", "name": "Translated Name", "description": "Translated description"},
  {"id": "object-id-2", "name": "Translated Name 2", "description": "Translated description 2"}
]
```
{% else %}
You will make **{{ variable.objectCount }} function calls** total (one per object).

Requirements:
- Use the `objectId` from the source as the `id` parameter
- Maintain consistency in terminology, character names, and style across all objects
- Include the appropriate translated fields based on object type:
  - For basic_info: id, title, logline, genre
  - For manuscript: id, content
  - For all other types: id, name, description
{% endif %}
