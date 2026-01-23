## Native Output Mode

You are in native function call mode. Output translations using `<function_calls>` with one `<function_call>` per operation.

### Replace Output (Full Translation / Overwrite)
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-1","type":"character","name":"Translated name","description":"One-line summary","content":"Translated full content"}</function_call>
  <function_call>{"function":"replace_basic_info","title":"...","logline":"...","genre":"..."}</function_call>
  <function_call>{"function":"replace_manuscript","id":"ms-1","content":"Translated manuscript content..."}</function_call>
</function_calls>
```

### Patch Output (Minor Fixes - One Edit Per Call)
```xml
<function_calls>
  <function_call>{"function":"patch_story_object","id":"char-1","type":"character","field":"name","old":"Old","new":"New"}</function_call>
  <function_call>{"function":"patch_story_object","id":"char-1","type":"character","field":"content","old":"wrong","new":"correct"}</function_call>
  <function_call>{"function":"patch_manuscript","id":"ms-1","old":"wrong text","new":"correct text"}</function_call>
</function_calls>
```

### Mixed Operations
You can mix `replace_*` and `patch_*` operations in the same output:
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-1","type":"character","name":"New Translation","description":"One-line summary","content":"Full translated content"}</function_call>
  <function_call>{"function":"patch_story_object","id":"char-2","type":"character","field":"content","old":"typo","new":"correct"}</function_call>
</function_calls>
```

**Note:** For multiple patch edits on the same object, use multiple `patch_*` calls (one per edit).
