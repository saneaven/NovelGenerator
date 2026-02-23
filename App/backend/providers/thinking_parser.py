"""Stateful parser for extracting <thinking> tags from streaming content"""

from typing import List, Dict


def has_unclosed_thinking_tag(messages: List[Dict]) -> bool:
    """
    Check if the last assistant message has an unclosed <thinking> tag.
    Used to determine if parser should start inside a thinking block.
    """
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            content = ""
            # Handle both string content and content parts
            msg_content = msg.get("content")
            if isinstance(msg_content, str):
                content = msg_content
            elif isinstance(msg_content, list):
                for part in msg_content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        content += part.get("text", "")

            if content:
                last_open = content.rfind("<thinking>")
                last_close = content.rfind("</thinking>")
                return last_open > last_close
            break
    return False


class ThinkingStreamParser:
    """
    Stateful parser that extracts <thinking>...</thinking> tags from streaming content.

    Handles:
    - Tags split across chunk boundaries
    - Multiple thinking blocks in sequence
    - Partial tags at chunk edges
    - Preserves order of content and thinking blocks
    - Can start inside a thinking block
    """

    def __init__(self, inside_thinking: bool = False):
        self.buffer = ""
        self.inside_thinking = inside_thinking
        self.thinking_accumulator = ""  # Accumulate to find </thinking> tag

    def process_chunk(self, content_chunk: str) -> tuple[str, str]:
        """
        Process a streaming content chunk.

        Args:
            content_chunk: New content to process

        Returns:
            (clean_content, thinking_content)
            - clean_content: Content outside <thinking> tags
            - thinking_content: Complete thinking block (only when </thinking> is found)
        """
        self.buffer += content_chunk
        clean_output = ""
        thinking_output = ""

        while True:
            if not self.inside_thinking:
                # Look for opening tag
                start_idx = self.buffer.find('<thinking>')

                if start_idx >= 0:
                    # Found opening tag - emit content before it
                    clean_output += self.buffer[:start_idx]
                    self.buffer = self.buffer[start_idx + 10:]  # Skip '<thinking>'
                    self.inside_thinking = True
                    self.thinking_accumulator = ""
                    continue

                else:
                    # Check if buffer ends with partial opening tag
                    partial_tags = ['<', '<t', '<th', '<thi', '<thin', '<think', '<thinki', '<thinkin', '<thinking']

                    for partial in reversed(partial_tags):
                        if self.buffer.endswith(partial):
                            # Hold back the partial tag
                            clean_output += self.buffer[:-len(partial)]
                            self.buffer = self.buffer[-len(partial):]
                            return clean_output, thinking_output

                    # No opening tag or partial - emit all as content
                    clean_output += self.buffer
                    self.buffer = ""
                    return clean_output, thinking_output

            else:  # Inside thinking tag
                # Look for closing tag
                end_idx = self.buffer.find('</thinking>')

                if end_idx >= 0:
                    # Found closing tag - emit remaining delta only
                    thinking_delta = self.buffer[:end_idx]
                    self.thinking_accumulator += thinking_delta
                    self.buffer = self.buffer[end_idx + 11:]  # Skip '</thinking>'
                    self.inside_thinking = False
                    self.thinking_accumulator = ""

                    # Return only the delta from this chunk
                    return clean_output, thinking_delta

                else:
                    # Check if buffer ends with partial closing tag
                    partial_tags = ['<', '</', '</t', '</th', '</thi', '</thin', '</think', '</thinki', '</thinkin', '</thinking']

                    for partial in reversed(partial_tags):
                        if self.buffer.endswith(partial):
                            # Hold back the partial tag, accumulate the rest
                            thinking_delta = self.buffer[:-len(partial)]
                            if thinking_delta:
                                self.thinking_accumulator += thinking_delta
                            self.buffer = self.buffer[-len(partial):]
                            # Return only the delta extracted from this chunk
                            return clean_output, thinking_delta

                    # No closing tag yet - send all buffer content as delta
                    thinking_delta = self.buffer
                    self.thinking_accumulator += thinking_delta
                    self.buffer = ""
                    return clean_output, thinking_delta

    def finalize(self) -> tuple[str, str]:
        """
        Flush remaining buffer when stream completes.

        Returns:
            (remaining_clean_content, remaining_thinking_content)
        """
        if self.inside_thinking:
            # Unclosed thinking tag - return remaining buffer delta only
            thinking_delta = self.buffer
            self.buffer = ""
            self.thinking_accumulator = ""
            self.inside_thinking = False
            return "", thinking_delta
        else:
            # Return remaining buffer as clean content
            content = self.buffer
            self.buffer = ""
            return content, ""
