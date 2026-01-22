## Content ({{ params.[0] }})

{{!--
  This fragment shows content in a specific language, filtered by IDs.
  Handles both story objects and manuscripts.

  Usage: {{prompt "translation/filteredContext" language ids}}

  Parameters:
    - params.[0]: Language name (e.g., "English", "Korean")
    - params.[1]: Array of IDs to filter (object IDs or manuscript IDs)
--}}

{{#with (getObjectsOfLanguage project params.[0] params.[1]) as |filteredObjects|}}
{{#if (hasItems (filterByType filteredObjects "character"))}}
<characters>
{{#each (filterByType filteredObjects "character")}}
<character id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</character>
{{/each}}
</characters>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "organization"))}}
<organizations>
{{#each (filterByType filteredObjects "organization")}}
<organization id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</organization>
{{/each}}
</organizations>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "location"))}}
<locations>
{{#each (filterByType filteredObjects "location")}}
<location id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</location>
{{/each}}
</locations>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "lorebook"))}}
<lorebooks>
{{#each (filterByType filteredObjects "lorebook")}}
<lorebook id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</lorebook>
{{/each}}
</lorebooks>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "outline"))}}
<outlines>
{{#each (filterByType filteredObjects "outline")}}
<outline id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</outline>
{{/each}}
</outlines>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "act"))}}
<acts>
{{#each (filterByType filteredObjects "act")}}
<act id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</act>
{{/each}}
</acts>
{{/if}}

{{#if (hasItems (filterByType filteredObjects "chapter"))}}
<chapters>
{{#each (filterByType filteredObjects "chapter")}}
<chapter id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
</chapter>
{{/each}}
</chapters>
{{/if}}
{{/with}}

{{#with (getManuscriptsOfLanguage project params.[0] params.[1]) as |filteredManuscripts|}}
{{#if (hasItems filteredManuscripts)}}
<manuscripts>
{{#each filteredManuscripts}}
<manuscript id="{{ this.id }}">
<chapter-name>{{ this.chapterName }}</chapter-name>
<content>{{ this.content }}</content>
</manuscript>
{{/each}}
</manuscripts>
{{/if}}
{{/with}}
