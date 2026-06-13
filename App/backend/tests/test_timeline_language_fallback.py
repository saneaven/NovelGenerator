from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

from App.backend.services.timeline_service import _extract_version_payload


def _entry(*rows):
    version = SimpleNamespace(id=uuid4(), version_number=3)
    created_at = datetime(2026, 1, 2, 3, 4, 5)
    return version, list(rows), created_at


def _row(language: str, name: str):
    return SimpleNamespace(language=language, data={"name": name, "description": ""})


def test_requested_language_returned_when_present() -> None:
    entry = _entry(_row("한국어", "주인공"), _row("English", "Protagonist"))
    data, version = _extract_version_payload(entry, "English")
    assert data == {"English": {"name": "Protagonist", "description": ""}}
    assert version["number"] == 3


def test_missing_language_falls_back_to_earliest_row() -> None:
    entry = _entry(_row("한국어", "주인공"), _row("日本語", "主人公"))
    data, _ = _extract_version_payload(entry, "English")
    assert data == {"한국어": {"name": "주인공", "description": ""}}


def test_fallback_skips_rows_without_dict_data() -> None:
    entry = _entry(SimpleNamespace(language="한국어", data=None), _row("English", "Protagonist"))
    data, _ = _extract_version_payload(entry, "日本語")
    assert data == {"English": {"name": "Protagonist", "description": ""}}


def test_no_language_returns_all_rows() -> None:
    entry = _entry(_row("한국어", "주인공"), _row("English", "Protagonist"))
    data, _ = _extract_version_payload(entry, None)
    assert set(data) == {"한국어", "English"}


def test_missing_entry_returns_empty_payload() -> None:
    data, version = _extract_version_payload(None, "English")
    assert data == {}
    assert version == {"id": None, "number": 0, "created_at": None}
