# Variable Validation Implementation

## Overview

Implemented real-time variable validation in the Prompt Editor to detect undefined variables and typos in LiquidJS templates. The system now warns users when they reference variables that don't exist in the current prompt schema.

## What Was Built

### 1. Variable Extraction (`engine.ts`)
- **Function**: `extractVariableReferences(template: string)`
- Uses LiquidJS's built-in static analysis (`engine.globalVariableSegments()`)
- Extracts **GLOBAL** variable references only (automatically excludes local variables from `{% assign %}` and `{% for %}` tags)
- Returns array of `VariableReference` objects containing:
  - `path`: Array of path segments (e.g., `['variable', 'language']`)
  - `fullPath`: Dot-notation string (e.g., `'variable.language'`)
  - `location`: Row and column information for error reporting

### 2. Schema Validator (`validator.ts`)
- **Function**: `mapFunctionTypeToSchemaType(functionType)`
  - Maps FunctionType → PromptType (chat, translation, storyObjectEdit, chapterEdit)

- **Function**: `validateVariablesAgainstSchema(references, schemaType)`
  - Validates each variable reference against the schema
  - Detects common typos (e.g., `varaible` → `variable`)
  - Provides helpful error messages with available field suggestions
  - Returns array of warnings with line/column information

### 3. Enhanced Validation (`engine.ts`)
- **Function**: `validateTemplate(template, schemaType?)`
  - Now returns `Promise<ValidationResult>`
  - Performs two-step validation:
    1. Syntax validation (LiquidJS parsing)
    2. Variable validation (if schemaType provided)
  - Returns both errors (syntax) and warnings (undefined variables)

### 4. UI Integration (`PromptEditor.tsx`)
- Maps `functionType` to `schemaType` for context-aware validation
- Passes schema type to `validateTemplate()`
- Displays variable warnings in the existing `ValidationWarnings` component
- Warnings are shown with yellow ⚡ icon
- Does NOT prevent saving (warnings only)

## Error Detection Examples

### Typo Detection
```liquid
{{ varaible.language }}
```
**Warning**: `Typo detected: 'varaible' should be 'variable'`

### Undefined Field
```liquid
{{ variable.nonExistentField }}
```
**Warning**: `Undefined variable: variable.nonExistentField. Available fields in 'variable': language, mode, today, functionInstructions`

### Wrong Schema
Using a chat-only variable in translation prompt:
```liquid
{{ variable.mode }}
```
**Warning**: `Undefined variable: variable.mode. Available fields in 'variable': sourceLanguage, targetLanguage, objectCount, objectsArray, userInstructions`

### Invalid Group
```liquid
{{ invalidGroup.someField }}
```
**Warning**: `Invalid variable group: 'invalidGroup'. Must use 'variable', 'context', or 'state'`

## Schema Mapping

| FunctionType | Maps To | Available Groups |
|-------------|---------|------------------|
| `chat` | `chat` | variable, context, state |
| `translation` | `translation` | variable, state |
| `storyEdit` | `storyObjectEdit` | variable, context, state |
| `chapterGen` | `chapterEdit` | variable, context, state |

## Key Design Decisions

1. **Warnings, Not Errors**: Undefined variables trigger warnings but don't prevent saving
   - Allows intentional use of undefined variables (render as empty string)
   - Gives users flexibility while highlighting potential issues

2. **Keep `strictVariables: false`**: Runtime behavior unchanged
   - Templates with undefined variables still render (as empty strings)
   - Backward compatible with existing templates

3. **Context-Aware**: Validation adapts to prompt type
   - Chat prompts validated against chat schema
   - Translation prompts validated against translation schema
   - Prevents false positives

4. **Typo Detection**: Common typos are specifically detected
   - `varaible`, `variabel` → suggests `variable`
   - `contxt`, `kontext` → suggests `context`

5. **Helpful Messages**: Warnings include available fields
   - Shows what variables ARE available
   - Makes it easy to find correct variable name

6. **Smart Local Variable Filtering**: Uses LiquidJS's `globalVariableSegments()`
   - Automatically excludes loop variables (from `{% for %}`)
   - Automatically excludes assigned variables (from `{% assign %}`)
   - No custom parsing needed - library handles scoping rules correctly

## Files Modified

1. **`App/frontend/src/templateEngine/engine.ts`**
   - Added `VariableReference` interface
   - Added `extractVariableReferences()` function
   - Enhanced `validateTemplate()` to return warnings
   - Added `ValidationResult` interface

2. **`App/frontend/src/templateEngine/validator.ts`** (NEW)
   - Schema mapping logic
   - Variable validation against schema
   - Helpful error message generation

3. **`App/frontend/src/components/SettingsModal/PromptEditor.tsx`**
   - Import schema mapping function
   - Pass schema type to validation
   - Handle async validation
   - Display warnings in UI

## Chat Schema Variables

The `chat` schema now includes all variables used in chat-related prompts:

**variable:**
- `language` - Output language
- `mode` - Operation mode (novelEditor | workspace)
- `today` - Current date
- `functionInstructions` - Function calling instructions

**state:**
- `enableThinking` - Enable thinking process
- `enablePrefill` - Enable prefill
- `enableCustomThinking` - Enable custom thinking
- `hasFunctions` - Whether functions are available

**context:**
- `recentMessages` - List of recent messages
- `functionResults` - Function call results (for userMessageTag)
- `storyContext` - Simplified story context (for userMessageTag)
- `novelContent` - Novel content by acts (for userMessageTag)
- `customSections` - Custom user sections (for userMessageTag)

## Testing

Tested scenarios:
- ✅ Valid templates (no warnings)
- ✅ Typo detection (`varaible` → `variable`)
- ✅ Undefined field detection with suggestions
- ✅ Wrong schema detection (chat var in translation)
- ✅ Invalid group detection
- ✅ Syntax errors still caught
- ✅ Loop variables correctly excluded
- ✅ Assigned variables correctly excluded
- ✅ UserMessageTag templates validate without false positives
- ✅ TypeScript compilation clean

## Benefits

1. **Immediate Feedback**: Users see warnings as they type (500ms debounce)
2. **Prevent Silent Failures**: No more mysterious empty strings from typos
3. **Better DX**: Suggestions make it easy to find correct variable names
4. **Maintainable**: Single source of truth (schema.ts) for all validation
5. **Non-Breaking**: Warnings only, existing behavior unchanged

## Future Enhancements

Potential improvements:
- Add autocomplete for variables in the editor
- Check for deeper nested paths (beyond `group.field`)
- Fuzzy matching for better typo suggestions
- Lint integration for CI/CD
- Export validation as standalone CLI tool
