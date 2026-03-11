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


def test_project_creation_seed_uses_array_based_basic_info() -> None:
    source = (BACKEND_ROOT / "routes" / "project_routes.py").read_text(encoding="utf-8")

    assert "empty_data = {'title': '', 'logline': '', 'genres': [], 'tags': []}" in source


def test_basic_info_tool_contracts_use_arrays_and_limit_patch_fields() -> None:
    replace_source = (
        BACKEND_ROOT / "services" / "tool_engine" / "modules" / "replace_module.py"
    ).read_text(encoding="utf-8")
    translate_source = (
        BACKEND_ROOT / "services" / "tool_engine" / "modules" / "translate_module.py"
    ).read_text(encoding="utf-8")
    patch_source = (
        BACKEND_ROOT / "services" / "tool_engine" / "modules" / "patch_module.py"
    ).read_text(encoding="utf-8")
    patch_translation_source = (
        BACKEND_ROOT / "services" / "tool_engine" / "modules" / "patch_translation_module.py"
    ).read_text(encoding="utf-8")

    for source in (replace_source, translate_source):
        assert '"genres": {"type": "array", "items": {"type": "string"}}' in source
        assert '"tags": {"type": "array", "items": {"type": "string"}}' in source
        assert 'for key in ["title", "logline", "genres", "tags"]' in source

    for source in (patch_source, patch_translation_source):
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
    assert "<genre>{{ this }}</genre>" in prompt_source
    assert "<tags>" in prompt_source
    assert "<tag>{{ this }}</tag>" in prompt_source
    assert "patch_basic_info` - Patch `title` or `logline`" in prompt_source
    assert "patch_translation_basic_info` | Fix basic info via search-replace | Requires `field` (title/logline)" in prompt_source
