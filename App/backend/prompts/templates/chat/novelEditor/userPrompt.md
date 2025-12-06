# User Message

{{ variable.userInput }}

{% if context.functionResults.size > 0 %}
# Function Call Results

Based on your previous suggestions, the user made the following decisions:

{% for result in context.functionResults %}
{% if result.success %}
- {{ result.functionName }}: APPLIED - {{ result.resultMessage }}
{% elsif result.isRejected %}
- {{ result.functionName }}: REJECTED BY USER - User chose not to apply this change
{% else %}
- {{ result.functionName }}: FAILED - {{ result.resultMessage }}
{% endif %}
{% endfor %}
{% endif %}

{% if context.storyContext %}
# Current Project Status

{% if context.storyContext.basicInfo %}
## Basic Info
- **Title**: {{ context.storyContext.basicInfo.title }}
{% if context.storyContext.basicInfo.logline %}- **Logline**: {{ context.storyContext.basicInfo.logline }}{% endif %}
{% if context.storyContext.basicInfo.genre %}- **Genre**: {{ context.storyContext.basicInfo.genre }}{% endif %}
{% endif %}

{% if context.storyContext.characters.size > 0 %}
## Characters
{% for char in context.storyContext.characters %}
### {{ char.name }}
{{ char.description }}
{% endfor %}
{% endif %}

{% if context.storyContext.organizations.size > 0 %}
## Organizations
{% for org in context.storyContext.organizations %}
### {{ org.name }}
{{ org.description }}
{% endfor %}
{% endif %}

{% if context.storyContext.locations.size > 0 %}
## Locations
{% for loc in context.storyContext.locations %}
### {{ loc.name }}
{{ loc.description }}
{% endfor %}
{% endif %}

{% if context.storyContext.lorebook.size > 0 %}
## Lorebook
{% for entry in context.storyContext.lorebook %}
### {{ entry.name }}
{{ entry.description }}
{% endfor %}
{% endif %}

{% if context.storyContext.acts.size > 0 %}
## Story Outline
{% for act in context.storyContext.acts %}
### {{ act.name }}
{{ act.description }}
{% for ch in act.chapters %}
- **{{ ch.name }}**: {{ ch.description }}
{% endfor %}
{% endfor %}
{% endif %}
{% endif %}

{% if context.novelContent %}
# Current Novel Content
```json
{{ context.novelContent | json }}
```
{% endif %}

{% if context.customSections.size > 0 %}
{% for section in context.customSections %}
# {{ section.heading }}
{% if section.format == 'json' %}
```json
{{ section.content | json }}
```
{% elsif section.format == 'text' %}
```text
{{ section.content }}
```
{% else %}
{{ section.content }}
{% endif %}
{% endfor %}
{% endif %}

# Language Instruction
You must use {{ variable.mainLanguage }} only.
