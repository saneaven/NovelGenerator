"""Stateful parser for extracting <thinking> tags from streaming content"""

class ThinkingStreamParser:
    """
    Stateful parser that extracts <thinking>...</thinking> tags from streaming content.

    Handles:
    - Tags split across chunk boundaries
    - Multiple thinking blocks in sequence
    - Partial tags at chunk edges
    - Preserves order of content and thinking blocks
    """

    def __init__(self):
        self.buffer = ""
        self.inside_thinking = False
        self.thinking_accumulator = ""  # Accumulates current thinking block

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
                    self.thinking_accumulator = ""  # Reset accumulator
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
                    # Found closing tag - emit complete thinking block
                    self.thinking_accumulator += self.buffer[:end_idx]
                    thinking_output = self.thinking_accumulator
                    self.buffer = self.buffer[end_idx + 11:]  # Skip '</thinking>'
                    self.inside_thinking = False
                    self.thinking_accumulator = ""

                    # Return immediately with complete block
                    # This preserves order: previous content, then this thinking block
                    return clean_output, thinking_output

                else:
                    # Check if buffer ends with partial closing tag
                    partial_tags = ['<', '</', '</t', '</th', '</thi', '</thin', '</think', '</thinki', '</thinkin', '</thinking']

                    for partial in reversed(partial_tags):
                        if self.buffer.endswith(partial):
                            # Hold back the partial tag, accumulate the rest
                            chunk_to_accumulate = self.buffer[:-len(partial)]
                            if chunk_to_accumulate:
                                self.thinking_accumulator += chunk_to_accumulate
                                thinking_output = self.thinking_accumulator  # Stream incremental update
                            self.buffer = self.buffer[-len(partial):]
                            return clean_output, thinking_output

                    # No closing tag yet - accumulate all in thinking buffer and stream it
                    self.thinking_accumulator += self.buffer
                    thinking_output = self.thinking_accumulator  # Stream incremental update
                    self.buffer = ""
                    return clean_output, thinking_output

    def finalize(self) -> tuple[str, str]:
        """
        Flush remaining buffer when stream completes.

        Returns:
            (remaining_clean_content, remaining_thinking_content)
        """
        if self.inside_thinking:
            # Unclosed thinking tag - return accumulated thinking + buffer as thinking
            thinking = self.thinking_accumulator + self.buffer
            self.buffer = ""
            self.thinking_accumulator = ""
            self.inside_thinking = False
            return "", thinking
        else:
            # Return remaining buffer as clean content
            content = self.buffer
            self.buffer = ""
            return content, ""
