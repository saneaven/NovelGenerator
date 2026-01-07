"""Stateful parser for extracting <function_calls> tags from streaming content.

Expected format:

<function_calls>
  <function_call>{"function":"name", ...args}</function_call>
  <function_call>{"function":"name2", ...args}</function_call>
</function_calls>

The parser removes the entire <function_calls> block from streamed content and emits
OpenAI-style tool_calls deltas for each completed <function_call>.
"""

from __future__ import annotations

import json
from typing import Dict, List, Tuple

OPEN_CALLS = "<function_calls>"
CLOSE_CALLS = "</function_calls>"
OPEN_CALL = "<function_call>"
CLOSE_CALL = "</function_call>"


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


class FunctionCallsStreamParser:
    """Chunk-safe parser for extracting function calls wrapped in <function_calls> tags."""

    def __init__(self) -> None:
        self.buffer = ""
        self.inside_calls = False
        self.inside_call = False
        self.call_buffer = ""
        self.call_index = 0

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
                    raise ValueError("Unexpected </function_calls> without opening <function_calls>")
                if self.buffer.find(OPEN_CALL) >= 0 or self.buffer.find(CLOSE_CALL) >= 0:
                    raise ValueError("Unexpected <function_call> outside <function_calls>")

                prefix, held = _split_partial_suffix(self.buffer, OPEN_CALLS_PARTIALS)
                clean_output += prefix
                self.buffer = held
                return clean_output, tool_calls

            if not self.inside_call:
                open_idx = self.buffer.find(OPEN_CALL)
                close_calls_idx = self.buffer.find(CLOSE_CALLS)
                close_call_idx = self.buffer.find(CLOSE_CALL)

                if self.buffer.find(OPEN_CALLS) >= 0:
                    raise ValueError("Nested <function_calls> blocks are not allowed")
                if close_call_idx >= 0 and (open_idx < 0 or close_call_idx < open_idx):
                    raise ValueError("Unexpected </function_call> without opening <function_call>")

                # Close the wrapper if it appears before the next call.
                if close_calls_idx >= 0 and (open_idx < 0 or close_calls_idx < open_idx):
                    self.buffer = self.buffer[close_calls_idx + len(CLOSE_CALLS):]
                    self.inside_calls = False
                    continue

                # Enter a <function_call> block.
                if open_idx >= 0:
                    self.buffer = self.buffer[open_idx + len(OPEN_CALL):]
                    self.inside_call = True
                    self.call_buffer = ""
                    continue

                # No complete tag yet. Hold back partial open/close tags; discard other inner text.
                _, held = _split_partial_suffix_any(self.buffer, [OPEN_CALL_PARTIALS, CLOSE_CALLS_PARTIALS])
                self.buffer = held
                return clean_output, tool_calls

            # Inside a <function_call> block: accumulate JSON until </function_call>.
            end_call_idx = self.buffer.find(CLOSE_CALL)
            if end_call_idx >= 0:
                self.call_buffer += self.buffer[:end_call_idx]
                self.buffer = self.buffer[end_call_idx + len(CLOSE_CALL):]
                self.inside_call = False

                raw = self.call_buffer.strip()
                try:
                    obj = json.loads(raw)
                except Exception as exc:
                    raise ValueError(f"Invalid JSON in <function_call>: {exc}") from exc
                if not isinstance(obj, dict):
                    raise ValueError("<function_call> JSON must be an object")

                fn = obj.get("function")
                if not isinstance(fn, str) or not fn.strip():
                    raise ValueError("<function_call> JSON missing required 'function' field")

                args = dict(obj)
                args.pop("function", None)

                tool_calls.append(
                    {
                        "index": self.call_index,
                        "id": f"native-fc-{self.call_index}",
                        "type": "function",
                        "function": {
                            "name": fn,
                            "arguments": json.dumps(args, separators=(",", ":")),
                        },
                    }
                )
                self.call_index += 1
                self.call_buffer = ""
                continue

            # No closing tag yet: hold back partial close tags at the edge.
            prefix, held = _split_partial_suffix(self.buffer, CLOSE_CALL_PARTIALS)
            if prefix:
                self.call_buffer += prefix
            self.buffer = held
            return clean_output, tool_calls

    def finalize(self) -> Tuple[str, List[Dict]]:
        """Flush remaining buffer on stream completion."""
        if self.inside_call or self.inside_calls:
            raise ValueError("Unclosed <function_calls> block")
        if self.buffer:
            tail = self.buffer
            self.buffer = ""
            return tail, []
        return "", []
