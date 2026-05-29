from __future__ import annotations

from pathlib import Path
import sys
import types


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import declarative_base


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    fake_pil = types.ModuleType("PIL")
    fake_pil.Image = object
    fake_pil.ImageOps = object
    sys.modules["PIL"] = fake_pil


_install_import_stubs()

from App.backend.services.basic_info_utils import (
    basic_info_summary_text,
    normalize_basic_info_data,
    normalize_string_list,
)
from App.backend.services.prompt_runtime.conversation_builder import _format_read_result_xml


BACKEND_ROOT = ROOT / "App" / "backend"


def test_normalize_string_list_trims_dedupes_and_preserves_order() -> None:
    assert normalize_string_list(
        [" Fantasy ", "", "Adventure", "Fantasy", None, "Adventure ", " Mystery "]
    ) == ["Fantasy", "Adventure", "Mystery"]


def test_normalize_basic_info_data_defaults_to_array_fields() -> None:
    assert normalize_basic_info_data(
        {
            "title": "  The Last Kingdom  ",
            "logline": " A fallen prince returns. ",
            "genres": [" Fantasy ", "Fantasy", "Adventure"],
            "tags": [" revenge ", "", "war", "revenge"],
        }
    ) == {
        "title": "  The Last Kingdom  ",
        "logline": " A fallen prince returns. ",
        "genres": ["Fantasy", "Adventure"],
        "tags": ["revenge", "war"],
    }

    assert normalize_basic_info_data({"title": None, "logline": None}) == {
        "title": "",
        "logline": "",
        "genres": [],
        "tags": [],
    }


def test_basic_info_summary_text_lists_genres_and_tags() -> None:
    summary = basic_info_summary_text(
        {
            "title": "The Last Kingdom",
            "logline": "A fallen prince returns.",
            "genres": ["Fantasy", "Adventure"],
            "tags": ["revenge", "war"],
        }
    )

    assert summary == "\n".join(
        [
            "Genres: Fantasy, Adventure",
            "Tags: revenge, war",
        ]
    )


def test_read_result_xml_renders_nested_genres_and_tags() -> None:
    xml = _format_read_result_xml(
        {
            "objectType": "basic_info",
            "objectId": "basic-1",
            "data": {
                "object": {
                    "title": "The Last Kingdom",
                    "logline": "A fallen prince returns.",
                    "genres": ["Fantasy", "Adventure"],
                    "tags": ["revenge", "war"],
                }
            },
        }
    )

    assert "<genres>" in xml
    assert "<genre>Fantasy</genre>" in xml
    assert "<genre>Adventure</genre>" in xml
    assert "<tags>" in xml
    assert "<tag>revenge</tag>" in xml
    assert "<tag>war</tag>" in xml
    assert "<logline>A fallen prince returns.</logline>" in xml


def test_timeline_track_read_result_xml_renders_reference_ids_only() -> None:
    xml = _format_read_result_xml(
        {
            "objectType": "timeline_track",
            "objectId": "track-1",
            "data": {
                "object": {
                    "name": "Main Plot",
                    "description": "Primary track.",
                    "content": "Track markdown.",
                    "parentId": None,
                    "position": 0,
                    "color": "#336699",
                    "childTrackIds": ["track-2"],
                    "eventIds": ["event-1", "event-2"],
                    "version": {"id": "version-1"},
                    "created_at": "2026-01-01T00:00:00",
                }
            },
        }
    )

    assert '<read_result type="timeline_track" id="track-1">' in xml
    assert "<name>Main Plot</name>" in xml
    assert "<childTrackIds>" in xml
    assert "<id>track-2</id>" in xml
    assert "<eventIds>" in xml
    assert "<id>event-1</id>" in xml
    assert "<id>event-2</id>" in xml
    assert "<version>" not in xml
    assert "created_at" not in xml


def test_timeline_event_read_result_xml_renders_dates_tags_and_link_refs_only() -> None:
    xml = _format_read_result_xml(
        {
            "objectType": "timeline_event",
            "objectId": "event-1",
            "data": {
                "object": {
                    "name": "Coronation",
                    "description": "A court ritual.",
                    "content": "Event markdown.",
                    "trackId": "track-1",
                    "startDate": {"year": 1, "month": 3},
                    "endDate": None,
                    "tags": ["court"],
                    "links": [{"linkId": "link-1", "objectType": "outline", "objectId": "outline-1", "created_at": "ignored"}],
                    "calendar": {"units": []},
                    "updated_at": "2026-01-01T00:00:00",
                }
            },
        }
    )

    assert '<read_result type="timeline_event" id="event-1">' in xml
    assert "<trackId>track-1</trackId>" in xml
    assert '<startDate>{"year":1,"month":3}</startDate>' in xml
    assert "<endDate />" in xml
    assert "<tag>court</tag>" in xml
    assert '<link linkId="link-1" objectType="outline" objectId="outline-1" />' in xml
    assert "calendar" not in xml
    assert "updated_at" not in xml
    assert "ignored" not in xml


def test_project_creation_seed_uses_array_based_basic_info() -> None:
    source = (BACKEND_ROOT / "routes" / "project_routes.py").read_text(encoding="utf-8")

    assert "empty_data = {'title': '', 'logline': '', 'genres': [], 'tags': []}" in source


def test_basic_info_tool_contracts_use_arrays_and_limit_patch_fields() -> None:
    source = (
        BACKEND_ROOT / "services" / "tool_engine" / "modules" / "project_data_module.py"
    ).read_text(encoding="utf-8")

    assert 'name="replace_basic_info"' in source
    assert 'name="translate_basic_info"' in source
    assert '"genres": {"type": "array", "items": {"type": "string"}}' in source
    assert '"tags": {"type": "array", "items": {"type": "string"}}' in source
    assert '("title", "logline", "genres", "tags")' in source

    assert 'name="patch_basic_info"' in source
    assert 'name="patch_translation_basic_info"' in source
    assert '"enum": ["title", "logline"]' in source
    assert "field must be one of title|logline" in source
    assert "genre" not in source.split('"enum": ["title", "logline"]', 1)[1][:120]


def test_basic_info_raw_output_remains_logline_only() -> None:
    source = (BACKEND_ROOT / "services" / "run_pipeline" / "raw_output.py").read_text(
        encoding="utf-8"
    )

    assert 'if category == "basic_info":' in source
    assert 'next_data["logline"] = text' in source
    assert 'elif object_type == "basic_info":' in source


def test_default_prompt_and_transfer_version_match_new_contract() -> None:
    prompt_source = (BACKEND_ROOT / "prompts" / "Default.nbprompt").read_text(
        encoding="utf-8"
    )
    transfer_source = (
        BACKEND_ROOT / "services" / "project_transfer_service.py"
    ).read_text(encoding="utf-8")

    assert '"format_version": 1' in prompt_source
    assert "FORMAT_VERSION = \"1.0\"" in transfer_source

    assert '\\"genres\\":[\\"Fantasy\\",\\"Adventure\\"]' in prompt_source
    assert '\\"tags\\":[\\"political intrigue\\",\\"academy\\"]' in prompt_source
    assert '- **Genres**: {{ project.basicInfo.genres|join(\\", \\") }}' in prompt_source
    assert '- **Tags**: {{ project.basicInfo.tags|join(\\", \\") }}' in prompt_source
    assert "<genres>" in prompt_source
    assert "<genre>{{ this|e }}</genre>" in prompt_source
    assert "<tags>" in prompt_source
    assert "<tag>{{ this|e }}</tag>" in prompt_source
    assert "patch_basic_info` - Patch `title` or `logline`" in prompt_source
    assert "patch_translation_basic_info` | Fix basic info via search-replace | Requires `field` (title/logline)" in prompt_source
