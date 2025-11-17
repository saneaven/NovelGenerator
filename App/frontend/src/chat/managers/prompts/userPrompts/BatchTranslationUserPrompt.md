# Batch Translation Request

Translate the following **{{var::objectCount}}** story objects from **{{var::sourceLanguage}}** to **{{var::targetLanguage}}**.

{{#if::userInstructions}}
## Additional Instructions

{{context::userInstructions}}
{{/if}}

## Objects to Translate ({{var::sourceLanguage}})

{{context::objectsArray}}

## Instructions

Please translate ALL {{var::objectCount}} objects maintaining consistency in terminology, character names, and style across all objects. Return the complete batch using the `translate_batch_story_objects` function with all translated objects in a single response.
