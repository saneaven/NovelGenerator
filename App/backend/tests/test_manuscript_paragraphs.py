from __future__ import annotations

import pytest

from App.backend.services.tool_engine.modules.manuscript_paragraphs import (
    parse_markdown_paragraph_offset,
    slice_markdown_by_paragraph_offset,
    split_markdown_paragraphs,
)


def test_slice_markdown_by_paragraph_offset_returns_requested_range() -> None:
    markdown = "Paragraph one.\n\nParagraph two.\n\nParagraph three."

    assert slice_markdown_by_paragraph_offset(markdown, {"from": 1, "to": 3}) == "Paragraph two.\n\nParagraph three."


def test_single_newline_stays_inside_markdown_paragraph() -> None:
    markdown = "Paragraph one line one.\nParagraph one line two.\n\nParagraph two."

    assert split_markdown_paragraphs(markdown) == [
        "Paragraph one line one.\nParagraph one line two.",
        "Paragraph two.",
    ]


def test_slice_markdown_by_paragraph_offset_clamps_end() -> None:
    markdown = "Paragraph one.\n\nParagraph two."

    assert slice_markdown_by_paragraph_offset(markdown, {"from": 1, "to": 99}) == "Paragraph two."


def test_slice_markdown_without_offset_returns_full_markdown() -> None:
    markdown = "Paragraph one.\n\nParagraph two.\n"

    assert slice_markdown_by_paragraph_offset(markdown, None) == markdown


@pytest.mark.parametrize(
    "offset",
    [
        {"from": -1, "to": 1},
        {"from": 1, "to": 1},
        {"from": 2, "to": 1},
        {"from": 1.0, "to": 2},
        {"from": False, "to": 2},
        {"from": 0, "to": "2"},
    ],
)
def test_parse_markdown_paragraph_offset_rejects_invalid_values(offset: object) -> None:
    with pytest.raises(ValueError):
        parse_markdown_paragraph_offset(offset)
