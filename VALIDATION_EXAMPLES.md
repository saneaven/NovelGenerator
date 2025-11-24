# Variable Validation Examples

## How It Works in the UI

When you edit a prompt in the Settings Modal, the validation runs automatically (with 500ms debounce).

### Example 1: Valid Template ✅

**Template:**
```liquid
# System Prompt

You are an AI assistant helping with {{ variable.language }} content.

{% if state.enableThinking %}
<thinking>
  Think carefully about the request.
</thinking>
{% endif %}

Recent messages: {{ context.recentMessages }}
```

**Result:**
- ✅ No warnings
- Save button enabled
- Green checkmark or no indicator

---

### Example 2: Typo in Variable Group ⚠️

**Template:**
```liquid
# Translation Prompt

Translate from {{ varaible.sourceLanguage }} to {{ variable.targetLanguage }}.
```

**UI Display:**
```
⚡ Warnings (1)
  - Line 3, Col 18: Typo detected: 'varaible' should be 'variable'
```

**Details:**
- Yellow warning icon
- Line and column information
- Specific suggestion to fix typo
- Template can still be saved

---

### Example 3: Undefined Field ⚠️

**Template:**
```liquid
# Chat Prompt

Language: {{ variable.language }}
Theme: {{ variable.theme }}
Mode: {{ variable.mode }}
```

**UI Display:**
```
⚡ Warnings (1)
  - Line 4, Col 11: Undefined variable: variable.theme. Available fields in 'variable': language, mode, today, functionInstructions
```

**Details:**
- Shows list of available fields
- Helps user find the correct variable name
- Template can still be saved (maybe theme was intentional)

---

### Example 4: Wrong Schema ⚠️

**Template (Translation Prompt):**
```liquid
# Translation User Prompt

Translate {{ variable.objectCount }} objects.

{% if variable.mode == 'workspace' %}
  Use workspace mode.
{% endif %}
```

**UI Display:**
```
⚡ Warnings (1)
  - Line 5, Col 10: Undefined variable: variable.mode. Available fields in 'variable': sourceLanguage, targetLanguage, objectCount, objectsArray, userInstructions
```

**Details:**
- `variable.mode` exists in chat schema but not translation schema
- Validation is context-aware
- Shows available fields for current prompt type

---

### Example 5: Multiple Warnings ⚠️

**Template:**
```liquid
# System Prompt

Language: {{ varaible.language }}
User: {{ variable.userName }}
Context: {{ context.currentData }}
```

**UI Display:**
```
⚡ Warnings (3)
  - Line 3, Col 15: Typo detected: 'varaible' should be 'variable'
  - Line 4, Col 11: Undefined variable: variable.userName. Available fields in 'variable': language, mode, today, functionInstructions
  - Line 5, Col 14: Undefined variable: context.currentData. Available fields in 'context': recentMessages
```

**Details:**
- All warnings listed
- Each with line/column information
- Template can still be saved

---

### Example 6: Syntax Error + Warnings ❌⚠️

**Template:**
```liquid
# System Prompt

Language: {{ variable.language
Theme: {{ variable.theme }}
```

**UI Display:**
```
⚠️ Syntax Errors (1)
  - Line 3, Col 1: output "{{ variable.language..." not closed

⚡ Warnings (1)
  - Line 4, Col 11: Undefined variable: variable.theme. Available fields in 'variable': language, mode, today, functionInstructions
```

**Details:**
- Syntax errors shown first (red icon)
- Warnings shown below (yellow icon)
- Save button DISABLED (syntax errors prevent saving)

---

## Available Variables by Prompt Type

### Chat Prompts
```yaml
variable:
  - language
  - mode
  - today
  - functionInstructions
state:
  - enableThinking
  - enablePrefill
  - enableCustomThinking
  - hasFunctions
context:
  - recentMessages
```

### Translation Prompts
```yaml
variable:
  - sourceLanguage
  - targetLanguage
  - objectCount
  - objectsArray
  - userInstructions
state:
  - enableThinking
  - enablePrefill
  - enableCustomThinking
context: []
```

### Story Edit Prompts
```yaml
variable:
  - language
  - category
  - categoryName
  - editScope
  - targetId
  - userRequest
state:
  - enableThinking
  - enablePrefill
  - enableCustomThinking
context:
  - currentData
  - contextData
```

### Chapter Generation Prompts
```yaml
variable:
  - language
  - chapterName
  - currentContent
  - userRequest
state:
  - enableThinking
  - enablePrefill
  - enableCustomThinking
context:
  - contextData
```

---

## Tips for Users

1. **Use autocomplete**: The UI shows available variables (future enhancement)
2. **Check warnings**: Yellow warnings help catch typos early
3. **Context matters**: Different prompt types have different available variables
4. **Nested access is OK**: `{{ context.recentMessages[0].content }}` is valid (we only check first two levels)
5. **Warnings don't block**: You can still save if you know what you're doing

---

## Common Mistakes

| Mistake | Correct | Warning Message |
|---------|---------|-----------------|
| `{{ varaible.language }}` | `{{ variable.language }}` | Typo detected: 'varaible' should be 'variable' |
| `{{ variable.languag }}` | `{{ variable.language }}` | Undefined variable: variable.languag. Available: language, mode, today, functionInstructions |
| `{{ context.data }}` | `{{ context.currentData }}` | Undefined variable: context.data. Available: currentData, contextData |
| `{{ state.thinking }}` | `{{ state.enableThinking }}` | Undefined variable: state.thinking. Available: enableThinking, enablePrefill, enableCustomThinking |

---

## Technical Notes

- **Validation runs**: Every 500ms after you stop typing
- **Async validation**: Non-blocking, won't freeze UI
- **Line numbers**: Match what you see in the editor
- **Case sensitive**: `variable.Language` ≠ `variable.language`
- **No autocorrect**: We warn but don't auto-fix (intentional design)
