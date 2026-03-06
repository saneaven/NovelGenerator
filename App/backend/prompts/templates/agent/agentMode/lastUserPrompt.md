# Current Project Status

{% with objectIds = agent.contextObjectIds %}
{% include "fragment:common/projectContext/filtered" %}
{% endwith %}

{% include "fragment:common/objectIndex" %}

# Language Instruction
You must use {{ config.mainLanguage }} only.

# User Message

{{ input.userMessage }}

