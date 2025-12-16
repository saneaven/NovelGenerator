# Chapter Editing Payload

Chapter: **{{ variable.currentChapterName }}** (ID: `{{ variable.currentChapterId }}`)

{% if context.contextData %}
## Project Context

{% if context.contextData.basicInfo %}
### Basic Information

- **Title**: {{ context.contextData.basicInfo.title }}
- **Logline**: {{ context.contextData.basicInfo.logline }}
- **Genre**: {{ context.contextData.basicInfo.genre }}
{% endif %}

{% if context.contextData.characters and context.contextData.characters.size > 0 %}
### Characters

{% for char in context.contextData.characters %}
#### {{ char.name }}

{{ char.description }}

{% endfor %}
{% endif %}

{% if context.contextData.organizations and context.contextData.organizations.size > 0 %}
### Organizations

{% for org in context.contextData.organizations %}
#### {{ org.name }}

{{ org.description }}

{% endfor %}
{% endif %}

{% if context.contextData.locations and context.contextData.locations.size > 0 %}
### Locations

{% for loc in context.contextData.locations %}
#### {{ loc.name }}

{{ loc.description }}

{% endfor %}
{% endif %}

{% if context.contextData.lorebook and context.contextData.lorebook.size > 0 %}
### Lorebook

{% for entry in context.contextData.lorebook %}
#### {{ entry.name }}

{{ entry.description }}

{% endfor %}
{% endif %}

{% if context.contextData.outline and context.contextData.outline.acts %}
### Story Outline

{% for act in context.contextData.outline.acts %}
#### Act: {{ act.name }}

{{ act.description }}

{% if act.chapters and act.chapters.size > 0 %}
**Chapters:**
{% for chapter in act.chapters %}
- **{{ chapter.name }}**: {{ chapter.description }}
{% endfor %}
{% endif %}

{% endfor %}
{% endif %}

{% if context.contextData.existingNovelContent and context.contextData.existingNovelContent.size > 0 %}
### Existing Novel Content

{% for chapterData in context.contextData.existingNovelContent %}
#### {{ chapterData.chapterName }} ({{ chapterData.wordCount }} words)

{% if chapterData.chapterDescription %}
*{{ chapterData.chapterDescription }}*
{% endif %}

{{ chapterData.content }}

---
{% endfor %}
{% endif %}

{% endif %}

## Current Chapter Content

{{ variable.currentChapterContent }}

{% if variable.userInput %}
## User Request

{{ variable.userInput }}
{% endif %}
