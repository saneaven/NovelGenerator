## Native Output Mode

You are in native function call mode. Output translations using `<function_calls>` with one `<function_call>` per operation.

### Replace Output (Full Translation / Overwrite)
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-1","type":"character","name":"Translated name","description":"Translated description"}</function_call>
  <function_call>{"function":"replace_basic_info","title":"...","logline":"...","genre":"..."}</function_call>
  <function_call>{"function":"replace_manuscript","id":"ms-1","content":"Translated manuscript content..."}</function_call>
</function_calls>
```

### Patch Output (Minor Fixes)
```xml
<function_calls>
  <function_call>{"function":"patch_story_object","id":"char-1","type":"character","replacements":[{"field":"name","old":"Old","new":"New"}]}</function_call>
  <function_call>{"function":"patch_manuscript","id":"ms-1","replacements":[{"old":"wrong text","new":"correct text"}]}</function_call>
</function_calls>
```

### Mixed Operations
You can mix `replace_*` and `patch_*` operations in the same output:
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-1","type":"character","name":"New Translation","description":"Full description"}</function_call>
  <function_call>{"function":"patch_story_object","id":"char-2","type":"character","replacements":[{"field":"description","old":"typo","new":"correct"}]}</function_call>
</function_calls>
```
