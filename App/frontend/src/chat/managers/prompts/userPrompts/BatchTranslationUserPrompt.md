# Batch Translation Request

Translate the following **{{var::objectCount}}** story objects from **{{var::sourceLanguage}}** to **{{var::targetLanguage}}**.

{{#if::userInstructions}}
## Additional Instructions

{{context::userInstructions}}
{{/if}}

## Objects to Translate ({{var::sourceLanguage}})

{{context::objectsArray}}

## Critical Instructions

**You MUST translate ALL {{var::objectCount}} objects** - do not skip any objects. Return the complete batch using the `translate_batch_story_objects` function with all translated objects in a single response.

Requirements:
- Maintain consistency in terminology, character names, and style across all objects
- Include the objectType and objectId for each object (matching the source)
- Include the appropriate translated fields based on object type:
  - For basicInfo objects: title, logline, genre
  - For all other object types: name, description
- The translations array must contain exactly {{var::objectCount}} objects
