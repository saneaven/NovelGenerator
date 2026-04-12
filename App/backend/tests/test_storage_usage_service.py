from __future__ import annotations

import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "1024")

from App.backend.models.translation_models import ObjectVersion, ObjectVersionLanguage
from App.backend.services.storage_usage_service import (
    StorageUsageBreakdown,
    StorageUsageDelta,
    _uuid_rows,
    build_asset_rows_delta,
    build_object_version_delta,
    build_story_core_delta,
    build_tool_call_delta,
    measure_asset_row,
    measure_object_version_language_row,
    measure_object_version_parent_row,
    measure_object_version_row,
    measure_project_row,
    snapshot_story_core_row,
    snapshot_tool_call_row,
)


def test_storage_usage_breakdown_total_and_dict() -> None:
    breakdown = StorageUsageBreakdown(
        project_meta_bytes=10,
        story_bytes=20,
        manuscript_bytes=30,
        chat_bytes=40,
        notification_bytes=50,
        image_run_bytes=60,
        image_bytes=70,
    )

    assert breakdown.total_bytes == 280
    assert breakdown.as_dict() == {
        "project_meta_bytes": 10,
        "story_bytes": 20,
        "manuscript_bytes": 30,
        "chat_bytes": 40,
        "notification_bytes": 50,
        "image_run_bytes": 60,
        "image_bytes": 70,
        "llm_log_bytes": 0,
        "total_bytes": 280,
    }


def test_storage_usage_delta_from_breakdowns() -> None:
    before = StorageUsageBreakdown(project_meta_bytes=5, story_bytes=10, image_bytes=20)
    after = StorageUsageBreakdown(project_meta_bytes=8, story_bytes=12, image_bytes=35)

    delta = StorageUsageDelta.from_breakdowns(before=before, after=after)

    assert delta.project_meta_bytes == 3
    assert delta.story_bytes == 2
    assert delta.image_bytes == 15
    assert delta.total_bytes == 20


def test_measure_project_row_counts_utf8_bytes() -> None:
    project = SimpleNamespace(name="프로젝트", description="abc")

    assert measure_project_row(project) == len("프로젝트".encode("utf-8")) + len("abc".encode("utf-8"))


def test_measure_object_version_row_counts_json_and_request() -> None:
    version = ObjectVersion(
        id=uuid4(),
        object_type="character",
        object_id=uuid4(),
        version_number=1,
    )
    version.languages.append(
        ObjectVersionLanguage(
            language="Korean",
            data={"name": "이름", "description": "설명"},
            user_request="User Edit",
        )
    )

    size = measure_object_version_row(version)

    assert size > len("User Edit".encode("utf-8"))
    assert size >= len("이름".encode("utf-8")) + len("설명".encode("utf-8"))


def test_object_version_language_split_deltas_track_child_rows() -> None:
    version = ObjectVersion(
        id=uuid4(),
        object_type="manuscript",
        object_id=uuid4(),
        version_number=1,
    )
    english = ObjectVersionLanguage(
        language="English",
        data={"content": {"type": "doc", "content": [{"type": "paragraph"}]}, "wordCount": 0},
        user_request="User Edit",
    )
    version.languages.append(english)

    parent_bytes = measure_object_version_parent_row(version)
    english_bytes = measure_object_version_language_row(english)
    assert measure_object_version_row(version) == parent_bytes + english_bytes

    before_translation = SimpleNamespace(object_type="manuscript", languages=[SimpleNamespace(data=english.data, user_request=english.user_request)])
    korean = ObjectVersionLanguage(
        language="Korean",
        data={"content": {"type": "doc", "content": [{"type": "paragraph", "text": "안녕"}]}, "wordCount": 1},
        user_request="AI Translation",
    )
    after_translation = SimpleNamespace(
        object_type="manuscript",
        languages=[
            SimpleNamespace(data=english.data, user_request=english.user_request),
            SimpleNamespace(data=korean.data, user_request=korean.user_request),
        ],
    )
    ko_bytes = measure_object_version_language_row(korean)
    assert build_object_version_delta(
        object_type="manuscript",
        before=before_translation,
        after=after_translation,
    ).manuscript_bytes == ko_bytes

    restored = SimpleNamespace(
        object_type="manuscript",
        languages=[SimpleNamespace(data=english.data, user_request="Restored from v1")],
    )
    restored_expected = measure_object_version_parent_row(restored) + measure_object_version_language_row(restored.languages[0])
    assert build_object_version_delta(
        object_type="manuscript",
        before=None,
        after=restored,
    ).manuscript_bytes == restored_expected

    after_delete = SimpleNamespace(object_type="manuscript", languages=[SimpleNamespace(data=english.data, user_request=english.user_request)])
    assert build_object_version_delta(
        object_type="manuscript",
        before=after_translation,
        after=after_delete,
    ).manuscript_bytes == -ko_bytes


def test_measure_asset_row_includes_file_size_and_metadata() -> None:
    asset = SimpleNamespace(
        file_size=123,
        name="Cover",
        generation_prompt={"content": "sunrise"},
        generation_positive_prompt=None,
        generation_negative_prompt=None,
        generation_settings={"quality": "high"},
        generation_reference_images=[{"asset_id": "x"}],
        generation_reference_objects=[{"id": "y", "type": "character"}],
    )

    size = measure_asset_row(asset)

    assert size > 123


def test_uuid_rows_accepts_row_like_values() -> None:
    target_id = uuid4()

    class RowLike:
        def __getitem__(self, index: int) -> object:
            if index != 0:
                raise IndexError
            return target_id

    assert _uuid_rows([RowLike(), target_id]) == [target_id, target_id]


def test_story_core_delta_ignores_non_measured_fields() -> None:
    row = SimpleNamespace(
        image_prompt="prompt",
        image_prompt_positive=None,
        image_prompt_negative=None,
        updated_at="before",
        status="draft",
    )

    before = snapshot_story_core_row(row)
    row.updated_at = "after"
    row.status = "published"

    delta = build_story_core_delta(before, snapshot_story_core_row(row))

    assert delta.total_bytes == 0


def test_asset_rows_delta_supports_negative_bulk_delete() -> None:
    rows = [
        SimpleNamespace(file_size=10, name="a", generation_prompt=None, generation_positive_prompt=None, generation_negative_prompt=None, generation_settings=None, generation_reference_images=None, generation_reference_objects=None),
        SimpleNamespace(file_size=20, name="b", generation_prompt=None, generation_positive_prompt=None, generation_negative_prompt=None, generation_settings=None, generation_reference_images=None, generation_reference_objects=None),
    ]

    delta = build_asset_rows_delta(rows, [])

    assert delta.image_bytes == -(measure_asset_row(rows[0]) + measure_asset_row(rows[1]))


def test_tool_call_delta_tracks_reason_and_result() -> None:
    row = SimpleNamespace(arguments={}, extra_content=None, reason=None, result=None)
    before = snapshot_tool_call_row(row)

    row.reason = "failed"
    row.result = {"message": "boom"}

    delta = build_tool_call_delta(before, snapshot_tool_call_row(row))

    assert delta.chat_bytes > 0
