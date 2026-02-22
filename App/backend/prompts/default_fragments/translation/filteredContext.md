## Content ({{ lang }})

{% with langProject = (project.languages.get(lang)) %}
{% if (langProject.basicInfo and (langProject.basicInfo.id in ids)) %}
<basic_info id="{{ langProject.basicInfo.id }}">
<title>{{ langProject.basicInfo.title }}</title>
<logline>{{ langProject.basicInfo.logline }}</logline>
<genre>{{ langProject.basicInfo.genre }}</genre>
</basic_info>
{% endif %}
{% endwith %}

{% if (project.guidelines.id and (project.guidelines.id in ids)) %}
<guidelines id="{{ project.guidelines.id }}">
<authorNote>{{ project.guidelines.authorNote }}</authorNote>
</guidelines>
{% endif %}

{% with filteredObjects = get_objects_of_language(project, lang, ids) %}
{% if (((filteredObjects|filter_by_type("character")))|length > 0) %}
<characters>
{% for this in (filteredObjects|filter_by_type("character")) %}
<character id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</character>
{% endfor %}
</characters>
{% endif %}

{% if (((filteredObjects|filter_by_type("organization")))|length > 0) %}
<organizations>
{% for this in (filteredObjects|filter_by_type("organization")) %}
<organization id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</organization>
{% endfor %}
</organizations>
{% endif %}

{% if (((filteredObjects|filter_by_type("location")))|length > 0) %}
<locations>
{% for this in (filteredObjects|filter_by_type("location")) %}
<location id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</location>
{% endfor %}
</locations>
{% endif %}

{% if (((filteredObjects|filter_by_type("lorebook")))|length > 0) %}
<lorebooks>
{% for this in (filteredObjects|filter_by_type("lorebook")) %}
<lorebook id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</lorebook>
{% endfor %}
</lorebooks>
{% endif %}

{% if (((filteredObjects|filter_by_type("outline")))|length > 0) %}
<outlines>
{% for this in (filteredObjects|filter_by_type("outline")) %}
<outline id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</outline>
{% endfor %}
</outlines>
{% endif %}

{% if (((filteredObjects|filter_by_type("act")))|length > 0) %}
<acts>
{% for this in (filteredObjects|filter_by_type("act")) %}
<act id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</act>
{% endfor %}
</acts>
{% endif %}

{% if (((filteredObjects|filter_by_type("chapter")))|length > 0) %}
<chapters>
{% for this in (filteredObjects|filter_by_type("chapter")) %}
<chapter id="{{ this.id }}">
<name>{{ this.name }}</name>
<description>{{ this.description }}</description>
<content>{{ this.content }}</content>
</chapter>
{% endfor %}
</chapters>
{% endif %}
{% endwith %}

{% with filteredManuscripts = get_manuscripts_of_language(project, lang, ids) %}
{% if ((filteredManuscripts)|length > 0) %}
<manuscripts>
{% for this in filteredManuscripts %}
<manuscript id="{{ this.id }}">
<chapter-name>{{ this.chapterName }}</chapter-name>
<content>{{ this.content }}</content>
</manuscript>
{% endfor %}
</manuscripts>
{% endif %}
{% endwith %}
