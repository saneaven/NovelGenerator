# Translation Request

Translate the following **{{ variable.objectCount }}** story objects from **{{ variable.sourceLanguage }}** to **{{ variable.targetLanguage }}**.

{% if variable.userInstructions %}
## Additional Instructions

{{ variable.userInstructions }}
{% endif %}

## Objects to Translate ({{ variable.sourceLanguage }})

{{ context.objectsArray | json }}

## Critical Instructions

**You MUST translate ALL {{ variable.objectCount }} objects** - do not skip any objects.

For each object, call the appropriate translation function:
- `translate_character` for character objects
- `translate_organization` for organization objects
- `translate_location` for location objects
- `translate_lorebook_entry` for lorebook objects
- `translate_act` for act objects
- `translate_chapter` for chapter objects
- `translate_basic_info` for basic_info objects
- `translate_manuscript` for manuscript objects

You will make **{{ variable.objectCount }} function calls** total (one per object).

Requirements:
- Use the `objectId` from the source as the `id` parameter
- Maintain consistency in terminology, character names, and style across all objects
- Include the appropriate translated fields based on object type:
  - For basic_info: id, title, logline, genre
  - For manuscript: id, content
  - For all other types: id, name, description
