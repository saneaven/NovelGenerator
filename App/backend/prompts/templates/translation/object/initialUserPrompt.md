# Translation Request

Translate the following content from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{% if ((translation.currentTranslatedContents)|length > 0) %}
## Preview Translations ({{ translation.targetLanguage }})

Review these existing translations to decide whether to use `translate_*` (full rewrite) or `translate_patch_*` (minor fixes):

<current>
{% for this in translation.currentTranslatedContents %}
### {{ this.type }}: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.translatedContent }}

{% endfor %}
</current>
{% endif %}

## Content to Translate

{{ prompt("translation/filteredContext", lang=translation.sourceLanguage, ids=translation.objectIds) }}

{% if input.userMessage %}
## Additional Instructions

{{ input.userMessage }}
{% endif %}
