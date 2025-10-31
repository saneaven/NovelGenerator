# Template Registry

Centralised metadata describing every double-bracket prompt template used by the
NovelGenerator application. The registry enables both the frontend and backend
to share a single source of truth for:

- Which templates exist (function type, category, variant).
- Which placeholders each template consumes (variables, contexts, conditionals).
- Rich descriptions of every placeholder so editor tooling can surface inline
  help and validators can produce actionable diagnostics.

## File Layout

```
App/shared/template_registry/
├─ README.md               # this file
└─ templates.json          # structured template metadata
```

`templates.json` contains:

- A top-level `version` for schema migrations.
- A `catalog` section that defines all supported placeholder names and their
  semantics.
- A `templates` array that maps each prompt template to the placeholders it
  consumes, indicating whether each placeholder is required for successful
  rendering.

Both the backend (Python) and frontend (TypeScript) engines will load this file
so that parsing, rendering, validation, syntax highlighting, and context
builders use the exact same definitions.
