## Native Output Mode

You are in native tool call mode. Output translations using one `<tool_call>` per operation.

### Translate Output (Full Translation / Overwrite)
```xml
<tool_call>{"tool":"translate_story_object","id":"char-1","type":"character","name":"Translated name","description":"One-line summary","content":"Translated full content"}</tool_call>
<tool_call>{"tool":"translate_basic_info","title":"...","logline":"...","genre":"..."}</tool_call>
<tool_call>{"tool":"translate_guidelines","id":"guidelines-1","authorNote":"Translated author note..."}</tool_call>
<tool_call>{"tool":"translate_manuscript","id":"ms-1","content":"Translated manuscript content..."}</tool_call>
```

### Patch Output (Minor Fixes - One Edit Per Call)
```xml
<tool_call>{"tool":"translate_patch_story_object","id":"char-1","type":"character","field":"name","old":"Old","new":"New"}</tool_call>
<tool_call>{"tool":"translate_patch_story_object","id":"char-1","type":"character","field":"content","old":"wrong","new":"correct"}</tool_call>
<tool_call>{"tool":"translate_patch_guidelines","id":"guidelines-1","field":"authorNote","old":"wrong","new":"correct"}</tool_call>
<tool_call>{"tool":"translate_patch_manuscript","id":"ms-1","old":"wrong text","new":"correct text"}</tool_call>
```

### Mixed Operations
You can mix `translate_*` and `translate_patch_*` operations in the same output:
```xml
<tool_call>{"tool":"translate_story_object","id":"char-1","type":"character","name":"New Translation","description":"One-line summary","content":"Full translated content"}</tool_call>
<tool_call>{"tool":"translate_patch_story_object","id":"char-2","type":"character","field":"content","old":"typo","new":"correct"}</tool_call>
```

**Note:** For multiple patch edits on the same object, use multiple `translate_patch_*` calls (one per edit).
