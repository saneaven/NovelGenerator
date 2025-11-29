# Workspace Function Access

Workspace mode uses small, single-purpose functions (Gemini-safe schemas). Call only when the user asks to change story structure.

## Available functions
- Basic info: `create_basic_info`, `update_basic_info`
- Characters: `create_character`, `update_character`, `delete_character`
- Organizations: `create_organization`, `update_organization`, `delete_organization`
- Locations: `create_location`, `update_location`, `delete_location`
- Lorebook: `create_lorebook_entry`, `update_lorebook_entry`, `delete_lorebook_entry`
- Acts: `create_act`, `update_act`, `delete_act` (you may include `chapters` array on create_act to add chapters together)
- Chapters: `create_chapter`, `update_chapter`, `delete_chapter`

## Usage rules
- Keep one function call per concrete action; do not batch disparate actions into one call.
- Include all required fields shown in the schemas; keep JSON minimal.
- Continue normal conversation; user will approve calls before applying.

## Quick examples
- Create character: `{ "name": "Aria", "description": "Space pilot" }`
- Update character: `{ "id": "char_123", "name": "Aria Chen" }`
- Create chapter: `{ "name": "Ambush", "description": "Battle in orbit", "actId": "act_5", "order": 2 }`
- Create act with chapters: `{ "name": "Act II", "description": "Rising action", "order": 1, "chapters": [ { "name": "Ch1", "description": "Setup", "order": 0 } ] }`
