"""Stateful parser for extracting native <tool_calls> tags from streaming content.

Expected format:

<tool_calls>
  <tool_call>{"tool":"name", ...args}</tool_call>
  <tool_call>{"tool":"name2", ...args}</tool_call>
</tool_calls>

The parser removes the entire <tool_calls> block from streamed content and emits
OpenAI-style tool_calls deltas for each <tool_call>.

Unlike a traditional "buffer until </tool_call>" implementation, this parser
streams tool_calls *incrementally* while the JSON inside <tool_call> is still
arriving. This enables UIs to render argument fields progressively (token-by-token)
while still keeping the overall model output in "native" (text) mode.
"""

from __future__ import annotations

import json
from typing import Dict, List, Optional, Tuple

OPEN_CALLS = "<tool_calls>"
CLOSE_CALLS = "</tool_calls>"
OPEN_CALL = "<tool_call>"
CLOSE_CALL = "</tool_call>"


def _build_partials(tag: str) -> List[str]:
    """All strict prefixes of a tag, used to hold back partial tag fragments at chunk edges."""
    return [tag[:i] for i in range(1, len(tag))]


OPEN_CALLS_PARTIALS = _build_partials(OPEN_CALLS)
CLOSE_CALLS_PARTIALS = _build_partials(CLOSE_CALLS)
OPEN_CALL_PARTIALS = _build_partials(OPEN_CALL)
CLOSE_CALL_PARTIALS = _build_partials(CLOSE_CALL)


def _split_partial_suffix(text: str, partials: List[str]) -> Tuple[str, str]:
    """If text ends with a partial tag fragment, split into (prefix, held_suffix)."""
    for partial in reversed(partials):
        if text.endswith(partial):
            return text[:-len(partial)], partial
    return text, ""


def _split_partial_suffix_any(text: str, partial_groups: List[List[str]]) -> Tuple[str, str]:
    """Pick the longest partial suffix match across multiple tag partial lists."""
    best: str = ""
    for group in partial_groups:
        for partial in reversed(group):
            if text.endswith(partial) and len(partial) > len(best):
                best = partial
                break
    if best:
        return text[:-len(best)], best
    return text, ""


class _JSONObjectExtractor:
    """Extract the first JSON object from a mixed text stream.

    Models sometimes wrap JSON in code fences (e.g. ```json ... ```), or include
    other text inside <tool_call>. For robustness, we ignore everything until
    the first '{', then stream through the matching '}' (brace-depth aware).

    Only the first JSON object is extracted; anything after it is ignored.
    """

    def __init__(self) -> None:
        self.started = False
        self.finished = False
        self._depth = 0
        self._in_string = False
        self._escape = False

    def process(self, text: str) -> str:
        if self.finished or not text:
            return ""

        out_parts: List[str] = []
        for ch in text:
            if not self.started:
                if ch == "{":
                    self.started = True
                    self._depth = 1
                    out_parts.append(ch)
                continue

            out_parts.append(ch)

            if self._in_string:
                if self._escape:
                    self._escape = False
                elif ch == "\\":
                    self._escape = True
                elif ch == '"':
                    self._in_string = False
                continue

            if ch == '"':
                self._in_string = True
                continue

            if ch == "{":
                self._depth += 1
            elif ch == "}":
                self._depth -= 1
                if self._depth == 0:
                    self.finished = True
                    break

        return "".join(out_parts)


class _ToolCallArgsStreamer:
    """Incrementally strip the top-level `"tool": ...` field from a JSON object stream.

    Input:  {"tool":"replace_story_object","id":"...","type":"character",...}
    Output: {"id":"...","type":"character",...}

    Also extracts the tool name (string value of the "tool" key).

    Important: This is a streaming transform. It never rewinds already-emitted output.
    To make comma-removal safe, it buffers the top-level comma separator and only
    emits it when the next pair is known to be kept.
    """

    def __init__(self) -> None:
        # JSON structural tracking
        self._stack: List[str] = []
        self._in_string = False
        self._escape = False

        # Top-level (outermost object) key parsing
        self._expecting_key = False
        self._prefix_buffer = ""

        self._pair_mode: Optional[str] = None  # None | "undecided" | "emit" | "skip_tool"
        self._pair_buffer = ""
        self._pair_has_leading_comma = False

        # String capture (key/tool value)
        self._string_capture_mode: Optional[str] = None  # None | "key" | "tool_value"
        self._key_chars: List[str] = []
        self._tool_chars: List[str] = []

        # For skipping the tool pair (to detect value start)
        self._seen_colon_for_tool = False

        # Extracted tool name
        self.tool_name: Optional[str] = None
        self._reported_tool_name = False

    def process(self, text: str) -> Tuple[str, Optional[str]]:
        out_parts: List[str] = []
        newly_discovered_fn: Optional[str] = None

        for ch in text:
            # Fast path: handle top-level pair boundaries (comma / end brace) when not in a string.
            is_top_obj = (len(self._stack) == 1 and self._stack[0] == "{")

            if not self._in_string and is_top_obj:
                # End of an emitted pair: buffer the comma for the *next* pair decision.
                if self._pair_mode == "emit" and ch == ",":
                    self._prefix_buffer += ","
                    self._expecting_key = True
                    self._pair_mode = None
                    continue

                # End of a skipped tool pair.
                if self._pair_mode == "skip_tool" and ch == ",":
                    # If the skipped pair had a leading comma, keep this comma (it becomes the
                    # separator between the previous and next kept pairs). Otherwise drop it.
                    self._prefix_buffer = "," if self._pair_has_leading_comma else ""
                    self._expecting_key = True
                    self._pair_mode = None
                    self._pair_has_leading_comma = False
                    self._seen_colon_for_tool = False
                    continue

                # Close top-level object.
                if ch == "}":
                    # Never allow a buffered comma to land right before '}'.
                    if self._prefix_buffer.lstrip().startswith(","):
                        self._prefix_buffer = ""
                    if self._prefix_buffer:
                        out_parts.append(self._prefix_buffer)
                        self._prefix_buffer = ""

                    # If we were skipping the tool pair, close the object anyway.
                    out_parts.append("}")

                    # Pop stack (top-level object)
                    if self._stack and self._stack[-1] == "{":
                        self._stack.pop()

                    self._expecting_key = False
                    self._pair_mode = None
                    self._pair_has_leading_comma = False
                    self._seen_colon_for_tool = False
                    continue

                # Start of a key (top-level object, between pairs)
                if self._pair_mode is None and self._expecting_key and ch == '"':
                    self._pair_mode = "undecided"
                    self._pair_has_leading_comma = self._prefix_buffer.lstrip().startswith(",")
                    self._pair_buffer = self._prefix_buffer + '"'
                    self._prefix_buffer = ""
                    self._expecting_key = False

                    self._string_capture_mode = "key"
                    self._key_chars = []

                    # Enter string (we consumed the quote)
                    self._in_string = True
                    self._escape = False
                    continue

            # If we are about to start capturing the tool value string (skip mode).
            if (
                not self._in_string
                and is_top_obj
                and self._pair_mode == "skip_tool"
                and self._seen_colon_for_tool
                and self.tool_name is None
                and ch == '"'
            ):
                self._string_capture_mode = "tool_value"
                self._tool_chars = []
                self._in_string = True
                self._escape = False
                # Do not output (skipping tool pair)
                continue

            # Output / buffer this character based on current mode.
            if self._pair_mode == "undecided":
                # Buffer until we know whether to emit or skip the pair.
                self._pair_buffer += ch
            elif self._pair_mode == "emit":
                # Emit as-is (nested structures handled by stack logic below).
                out_parts.append(ch)
            elif self._pair_mode == "skip_tool":
                # Skip everything inside the tool pair, but watch for ':' so we can capture the value.
                if not self._in_string and is_top_obj and not self._seen_colon_for_tool and ch == ":":
                    self._seen_colon_for_tool = True
                # No output.
            else:
                # Between pairs or outside the top-level object: buffer indentation/whitespace before a key.
                if is_top_obj and self._expecting_key:
                    self._prefix_buffer += ch
                else:
                    out_parts.append(ch)

            # Capture string content if requested (key or tool value).
            if self._in_string and self._string_capture_mode in {"key", "tool_value"}:
                # Capture everything except an unescaped closing quote.
                if not (ch == '"' and not self._escape):
                    if self._string_capture_mode == "key":
                        self._key_chars.append(ch)
                    elif self._string_capture_mode == "tool_value":
                        self._tool_chars.append(ch)

            # Update string parsing state.
            if self._in_string:
                if self._escape:
                    self._escape = False
                elif ch == "\\":
                    self._escape = True
                elif ch == '"':
                    # End of string.
                    self._in_string = False

                    if self._string_capture_mode == "key":
                        raw_key = "".join(self._key_chars)
                        self._string_capture_mode = None
                        self._key_chars = []
                        try:
                            key = json.loads(f'"{raw_key}"')
                        except Exception:
                            key = raw_key

                        if key == "tool":
                            # Skip this entire pair; do not emit buffered prefix/key.
                            self._pair_mode = "skip_tool"
                            self._pair_buffer = ""
                            self._seen_colon_for_tool = False
                        else:
                            # Keep this pair: flush buffered prefix+key then emit rest as it arrives.
                            self._pair_mode = "emit"
                            if self._pair_buffer:
                                out_parts.append(self._pair_buffer)
                            self._pair_buffer = ""

                    elif self._string_capture_mode == "tool_value":
                        raw_tool = "".join(self._tool_chars)
                        self._string_capture_mode = None
                        self._tool_chars = []
                        try:
                            tool = json.loads(f'"{raw_tool}"')
                        except Exception:
                            tool = raw_tool

                        if isinstance(tool, str) and tool.strip() and self.tool_name is None:
                            self.tool_name = tool
                            if not self._reported_tool_name:
                                newly_discovered_fn = tool
                                self._reported_tool_name = True
            else:
                # Start of any JSON string (keys or values) outside our dedicated capture modes.
                # Without this, commas/braces inside string values can be misinterpreted as
                # top-level JSON delimiters while streaming.
                if ch == '"':
                    self._in_string = True
                    self._escape = False

            # Update structural stack (only when not inside a string).
            if not self._in_string:
                if ch in "{[":
                    self._stack.append(ch)
                    # Opening the top-level object means we're now expecting a key.
                    if len(self._stack) == 1 and self._stack[0] == "{":
                        self._expecting_key = True
                elif ch in "}]":
                    if self._stack:
                        opener = self._stack[-1]
                        if (opener == "{" and ch == "}") or (opener == "[" and ch == "]"):
                            self._stack.pop()
                            if not self._stack:
                                self._expecting_key = False

        return "".join(out_parts), newly_discovered_fn


class NativeToolCallsStreamParser:
    """Chunk-safe parser for extracting native tool calls wrapped in <tool_calls> tags."""

    def __init__(self) -> None:
        self.buffer = ""
        self.inside_calls = False
        self.inside_call = False
        self.call_buffer = ""
        self.call_index = 0
        self._active_call_id: Optional[str] = None
        self._active_tool_name: Optional[str] = None
        self._json_extractor: Optional[_JSONObjectExtractor] = None
        self._args_streamer: Optional[_ToolCallArgsStreamer] = None
        self._emitted_call_start = False
        self.tool_calls_completed = False  # True when </tool_calls> is processed

    def process_chunk(self, content_chunk: str) -> Tuple[str, List[Dict]]:
        """Process a streaming content chunk and return (clean_content, tool_calls)."""
        self.buffer += content_chunk
        clean_output = ""
        tool_calls: List[Dict] = []

        while True:
            if not self.inside_calls:
                start_idx = self.buffer.find(OPEN_CALLS)
                if start_idx >= 0:
                    clean_output += self.buffer[:start_idx]
                    self.buffer = self.buffer[start_idx + len(OPEN_CALLS):]
                    self.inside_calls = True
                    continue

                # Hard errors for structurally invalid sequences (no fallback).
                if self.buffer.find(CLOSE_CALLS) >= 0:
                    raise ValueError("Unexpected </tool_calls> without opening <tool_calls>")
                if self.buffer.find(OPEN_CALL) >= 0 or self.buffer.find(CLOSE_CALL) >= 0:
                    raise ValueError("Unexpected <tool_call> outside <tool_calls>")

                prefix, held = _split_partial_suffix(self.buffer, OPEN_CALLS_PARTIALS)
                clean_output += prefix
                self.buffer = held
                return clean_output, tool_calls

            if not self.inside_call:
                open_idx = self.buffer.find(OPEN_CALL)
                close_calls_idx = self.buffer.find(CLOSE_CALLS)
                close_call_idx = self.buffer.find(CLOSE_CALL)

                if self.buffer.find(OPEN_CALLS) >= 0:
                    raise ValueError("Nested <tool_calls> blocks are not allowed")
                if close_call_idx >= 0 and (open_idx < 0 or close_call_idx < open_idx):
                    raise ValueError("Unexpected </tool_call> without opening <tool_call>")

                # Close the wrapper if it appears before the next call.
                if close_calls_idx >= 0 and (open_idx < 0 or close_calls_idx < open_idx):
                    self.buffer = self.buffer[close_calls_idx + len(CLOSE_CALLS):]
                    self.inside_calls = False
                    self.tool_calls_completed = True  # Signal that tool calls block is complete
                    continue

                # Enter a <tool_call> block.
                if open_idx >= 0:
                    self.buffer = self.buffer[open_idx + len(OPEN_CALL):]
                    self.inside_call = True
                    self.call_buffer = ""
                    self._active_call_id = f"native-tool-call-{self.call_index}"
                    self._active_tool_name = None
                    self._json_extractor = _JSONObjectExtractor()
                    self._args_streamer = _ToolCallArgsStreamer()
                    self._emitted_call_start = True
                    tool_calls.append(
                        {
                            "index": self.call_index,
                            "id": self._active_call_id,
                            "type": "function",
                        }
                    )
                    continue

                # No complete tag yet. Hold back partial open/close tags; discard other inner text.
                _, held = _split_partial_suffix_any(self.buffer, [OPEN_CALL_PARTIALS, CLOSE_CALLS_PARTIALS])
                self.buffer = held
                return clean_output, tool_calls

            # Inside a <tool_call> block: accumulate JSON until </tool_call>.
            end_call_idx = self.buffer.find(CLOSE_CALL)
            if end_call_idx >= 0:
                prefix = self.buffer[:end_call_idx]
                json_delta = self._json_extractor.process(prefix) if (self._json_extractor and prefix) else ""
                if json_delta:
                    self.call_buffer += json_delta

                if self._args_streamer is not None and json_delta:
                    args_delta, new_tool = self._args_streamer.process(json_delta)
                    if new_tool:
                        self._active_tool_name = new_tool
                    if args_delta or new_tool:
                        delta_fn: Dict[str, object] = {}
                        if new_tool:
                            delta_fn["name"] = new_tool
                        if args_delta:
                            delta_fn["arguments"] = args_delta
                        tool_calls.append(
                            {
                                "index": self.call_index,
                                "id": self._active_call_id,
                                "type": "function",
                                "function": delta_fn,
                            }
                        )

                self.buffer = self.buffer[end_call_idx + len(CLOSE_CALL):]
                self.inside_call = False

                raw = self.call_buffer.strip()
                try:
                    obj = json.loads(raw)
                except Exception as exc:
                    raise ValueError(f"Invalid JSON in <tool_call>: {exc}") from exc
                if not isinstance(obj, dict):
                    raise ValueError("<tool_call> JSON must be an object")

                tool = obj.get("tool")
                if not isinstance(tool, str) or not tool.strip():
                    raise ValueError("<tool_call> JSON missing required 'tool' field")

                # If we couldn't extract the name while streaming, emit it once now.
                if self._active_tool_name is None:
                    self._active_tool_name = tool
                    tool_calls.append(
                        {
                            "index": self.call_index,
                            "id": self._active_call_id,
                            "type": "function",
                            "function": {"name": tool},
                        }
                    )

                self.call_index += 1
                self.call_buffer = ""
                self._active_call_id = None
                self._active_tool_name = None
                self._json_extractor = None
                self._args_streamer = None
                self._emitted_call_start = False
                continue

            # No closing tag yet: hold back partial close tags at the edge.
            prefix, held = _split_partial_suffix(self.buffer, CLOSE_CALL_PARTIALS)
            if prefix:
                json_delta = self._json_extractor.process(prefix) if self._json_extractor else ""
                if json_delta:
                    self.call_buffer += json_delta

                if self._args_streamer is not None and json_delta:
                    args_delta, new_tool = self._args_streamer.process(json_delta)
                    if new_tool:
                        self._active_tool_name = new_tool
                    if args_delta or new_tool:
                        delta_fn: Dict[str, object] = {}
                        if new_tool:
                            delta_fn["name"] = new_tool
                        if args_delta:
                            delta_fn["arguments"] = args_delta
                        tool_calls.append(
                            {
                                "index": self.call_index,
                                "id": self._active_call_id,
                                "type": "function",
                                "function": delta_fn,
                            }
                        )
            self.buffer = held
            return clean_output, tool_calls

    def finalize(self) -> Tuple[str, List[Dict]]:
        """Flush remaining buffer on stream completion."""
        if self.inside_call or self.inside_calls:
            raise ValueError("Unclosed <tool_calls> block")
        if self.buffer:
            tail = self.buffer
            self.buffer = ""
            return tail, []
        return "", []
