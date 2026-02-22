# Current Project Status

{{ prompt("common/projectContext/filtered", objectIds=agent.contextObjectIds) }}

{{ prompt("common/objectIndex") }}

# Language Instruction
You must use {{ config.mainLanguage }} only.

# User Message

{{ input.userMessage }}

