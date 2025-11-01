# Template Registry

Centralised metadata describing every double-bracket prompt template used by the
NovelGenerator application. The registry provides a single source of truth for:

- Which templates exist (function type, category, variant).
- Which placeholders each template consumes (variables, contexts, conditionals).
- Rich descriptions of every placeholder so editors and validators can surface
  actionable diagnostics.

## File Layout

```
App/backend/data/template_registry/
- README.md        # this file
- templates.json   # structured template metadata
```

`templates.json` contains:

- A top-level `version` for schema migrations.
- A `catalog` section that defines all supported placeholder names and their
  semantics.
- A `templates` array that maps each prompt template to the placeholders it
  consumes, indicating whether each placeholder is required for successful
  rendering.

The backend loads this file and serves the metadata through the
`/api/v1/prompts/syntax/metadata` endpoint so that every runtime client consumes
consistent definitions.
