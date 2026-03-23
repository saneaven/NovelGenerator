from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import sys
import types
from uuid import UUID, uuid4

from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import BinaryExpression, BindParameter, BooleanClauseList, UnaryExpression

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["database"] = fake_database

    fake_httpx = types.ModuleType("httpx")

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    fake_httpx.AsyncClient = _FakeAsyncClient
    fake_httpx.HTTPError = Exception
    sys.modules["httpx"] = fake_httpx


_install_import_stubs()

import App.backend.services.prompt_runtime.project_data_builder as project_data_builder_module
from App.backend.models.db_models import BasicInfo, Guidelines, Manuscript, Outline, StoryEntity
from App.backend.models.translation_models import ObjectVersion
from App.backend.services.prompt_runtime.project_data_builder import _build_outline_numbering, build_project_data


def _outline(
    *,
    project_id: UUID,
    kind: str,
    position: int,
    parent_id: UUID | None = None,
    created_offset: int = 0,
) -> Outline:
    created_at = datetime(2025, 1, 1, 12, 0, 0) + timedelta(minutes=created_offset)
    return Outline(
        id=uuid4(),
        project_id=project_id,
        kind=kind,
        parent_id=parent_id,
        position=position,
        created_at=created_at,
        updated_at=created_at,
    )


def _object_version(*, object_type: str, object_id: UUID, data: dict) -> ObjectVersion:
    return ObjectVersion(
        id=uuid4(),
        object_type=object_type,
        object_id=object_id,
        version_number=1,
        data=data,
    )


def _operand_value(operand, row: object, joined_outline: Outline | None = None):
    name = getattr(operand, "name", None)
    if name and hasattr(row, name):
        return getattr(row, name)
    if name and joined_outline is not None and hasattr(joined_outline, name):
        return getattr(joined_outline, name)
    if isinstance(operand, BindParameter):
        return operand.value
    if operand.__class__.__name__ == "Null":
        return None
    return operand


def _matches(row: object, criterion, joined_outline: Outline | None = None) -> bool:
    if isinstance(criterion, BooleanClauseList):
        op_name = getattr(criterion.operator, "__name__", "")
        if op_name == "and_":
            return all(_matches(row, clause, joined_outline) for clause in criterion.clauses)
        raise AssertionError(f"Unsupported boolean operator: {criterion.operator!r}")

    if isinstance(criterion, BinaryExpression):
        left = _operand_value(criterion.left, row, joined_outline)
        right = _operand_value(criterion.right, row, joined_outline)
        op_name = getattr(criterion.operator, "__name__", "")
        if op_name == operators.eq.__name__:
            return left == right
        if op_name == operators.is_.__name__:
            return left is right
        raise AssertionError(f"Unsupported binary operator: {criterion.operator!r}")

    raise AssertionError(f"Unsupported criterion: {criterion!r}")


class _FakeQuery:
    def __init__(self, db: "_FakeDb", model: object) -> None:
        self._db = db
        self._model = model
        self._criteria: list[object] = []
        self._order_by: list[object] = []
        self._joined_outline = False

    def filter(self, *criteria) -> "_FakeQuery":
        self._criteria.extend(criteria)
        return self

    def order_by(self, *expressions) -> "_FakeQuery":
        self._order_by.extend(expressions)
        return self

    def join(self, *_args, **_kwargs) -> "_FakeQuery":
        self._joined_outline = True
        return self

    def all(self) -> list[object]:
        rows = list(self._db.rows.get(self._model, []))
        filtered: list[object] = []
        for row in rows:
            joined_outline = None
            if self._model is Manuscript and self._joined_outline:
                joined_outline = self._db.outlines_by_id.get(row.chapter_id)
            if all(_matches(row, criterion, joined_outline) for criterion in self._criteria):
                filtered.append(row)

        for expression in reversed(self._order_by):
            column = getattr(getattr(expression, "element", None), "name", None) or getattr(expression, "name", None)
            if not column:
                raise AssertionError(f"Unsupported order expression: {expression!r}")
            reverse = isinstance(expression, UnaryExpression) and getattr(expression.modifier, "__name__", "") == "desc_op"
            filtered.sort(key=lambda row: getattr(row, column), reverse=reverse)

        return filtered

    def first(self):
        rows = self.all()
        return rows[0] if rows else None


class _FakeDb:
    def __init__(self, *, rows: dict[object, list[object]], outlines: list[Outline]) -> None:
        self.rows = rows
        self.outlines_by_id = {row.id: row for row in outlines}

    def query(self, model: object) -> _FakeQuery:
        if model not in self.rows:
            raise AssertionError(f"Unsupported model query: {model!r}")
        return _FakeQuery(self, model)


class _FakeSidecar:
    async def doc_to_markdown(self, doc: dict) -> str:
        return str(doc.get("markdown") or "")


def _stub_story_entity_tree_helpers(monkeypatch) -> None:
    monkeypatch.setattr(project_data_builder_module, "list_story_entity_folders", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(project_data_builder_module, "build_story_entity_folder_path_map", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(project_data_builder_module, "build_story_entity_folder_content_map", lambda *_args, **_kwargs: {})


def test_build_outline_numbering_resets_per_root_outline_and_ignores_invalid_hierarchy() -> None:
    project_id = uuid4()

    outline_a = _outline(project_id=project_id, kind="outline", position=0, created_offset=0)
    act_a2 = _outline(project_id=project_id, kind="act", parent_id=outline_a.id, position=1, created_offset=3)
    chapter_a2 = _outline(project_id=project_id, kind="chapter", parent_id=act_a2.id, position=0, created_offset=4)
    act_a1 = _outline(project_id=project_id, kind="act", parent_id=outline_a.id, position=0, created_offset=1)
    chapter_a1 = _outline(project_id=project_id, kind="chapter", parent_id=act_a1.id, position=0, created_offset=2)
    invalid_direct_chapter = _outline(project_id=project_id, kind="chapter", parent_id=outline_a.id, position=9, created_offset=5)
    invalid_nested_act = _outline(project_id=project_id, kind="act", parent_id=act_a1.id, position=1, created_offset=6)

    outline_b = _outline(project_id=project_id, kind="outline", position=1, created_offset=7)
    act_b1 = _outline(project_id=project_id, kind="act", parent_id=outline_b.id, position=0, created_offset=8)
    chapter_b1 = _outline(project_id=project_id, kind="chapter", parent_id=act_b1.id, position=0, created_offset=9)

    numbering = _build_outline_numbering(
        [
            chapter_b1,
            invalid_nested_act,
            chapter_a2,
            act_a2,
            outline_b,
            act_a1,
            outline_a,
            invalid_direct_chapter,
            act_b1,
            chapter_a1,
        ]
    )

    assert numbering[act_a1.id] == {"actNumber": 1, "chapterNumber": None}
    assert numbering[chapter_a1.id] == {"actNumber": 1, "chapterNumber": 1}
    assert numbering[act_a2.id] == {"actNumber": 2, "chapterNumber": None}
    assert numbering[chapter_a2.id] == {"actNumber": 2, "chapterNumber": 2}
    assert numbering[act_b1.id] == {"actNumber": 1, "chapterNumber": None}
    assert numbering[chapter_b1.id] == {"actNumber": 1, "chapterNumber": 1}
    assert invalid_direct_chapter.id not in numbering
    assert invalid_nested_act.id not in numbering


def test_build_project_data_adds_canonical_outline_and_manuscript_numbers(monkeypatch) -> None:
    project_id = uuid4()

    outline = _outline(project_id=project_id, kind="outline", position=0, created_offset=0)
    act_1 = _outline(project_id=project_id, kind="act", parent_id=outline.id, position=0, created_offset=1)
    chapter_1 = _outline(project_id=project_id, kind="chapter", parent_id=act_1.id, position=0, created_offset=2)
    act_2 = _outline(project_id=project_id, kind="act", parent_id=outline.id, position=1, created_offset=3)
    chapter_2 = _outline(project_id=project_id, kind="chapter", parent_id=act_2.id, position=0, created_offset=4)

    manuscript_1 = Manuscript(id=uuid4(), chapter_id=chapter_1.id)
    manuscript_2 = Manuscript(id=uuid4(), chapter_id=chapter_2.id)

    versions = [
        _object_version(
            object_type="outline",
            object_id=outline.id,
            data={"English": {"name": "Main Outline", "description": "Outline", "content": "Root"}}),
        _object_version(
            object_type="outline",
            object_id=act_1.id,
            data={"English": {"name": "Setup", "description": "Act One", "content": "Act One content"}}),
        _object_version(
            object_type="outline",
            object_id=chapter_1.id,
            data={"English": {"name": "The Raid", "description": "Chapter One", "content": "Chapter One content"}}),
        _object_version(
            object_type="outline",
            object_id=act_2.id,
            data={"English": {"name": "Counterattack", "description": "Act Two", "content": "Act Two content"}}),
        _object_version(
            object_type="outline",
            object_id=chapter_2.id,
            data={"English": {"name": "The Escape", "description": "Chapter Two", "content": "Chapter Two content"}}),
        _object_version(
            object_type="manuscript",
            object_id=manuscript_1.id,
            data={"English": {"doc": {"markdown": "Alpha manuscript"}, "wordCount": 2}}),
        _object_version(
            object_type="manuscript",
            object_id=manuscript_2.id,
            data={"English": {"doc": {"markdown": "Beta manuscript"}, "wordCount": 2}}),
    ]

    db = _FakeDb(
        rows={
            BasicInfo: [],
            Guidelines: [],
            StoryEntity: [],
            Outline: [outline, act_2, chapter_1, act_1, chapter_2],
            Manuscript: [manuscript_1, manuscript_2],
            ObjectVersion: versions,
        },
        outlines=[outline, act_1, chapter_1, act_2, chapter_2],
    )

    _stub_story_entity_tree_helpers(monkeypatch)

    project = asyncio.run(build_project_data(db, project_id, "English", _FakeSidecar()))

    nodes_by_id = {node["id"]: node for node in project["outline"]["nodes"]}
    assert nodes_by_id[str(act_1.id)]["actNumber"] == 1
    assert nodes_by_id[str(chapter_1.id)]["actNumber"] == 1
    assert nodes_by_id[str(chapter_1.id)]["chapterNumber"] == 1
    assert nodes_by_id[str(act_2.id)]["actNumber"] == 2
    assert nodes_by_id[str(chapter_2.id)]["actNumber"] == 2
    assert nodes_by_id[str(chapter_2.id)]["chapterNumber"] == 2

    tree_children = project["outline"]["tree"][0]["children"]
    assert tree_children[0]["actNumber"] == 1
    assert tree_children[0]["children"][0]["chapterNumber"] == 1
    assert tree_children[1]["actNumber"] == 2
    assert tree_children[1]["children"][0]["chapterNumber"] == 2

    manuscripts = project["manuscripts"]
    assert manuscripts[0]["chapterName"] == "The Raid"
    assert manuscripts[0]["actNumber"] == 1
    assert manuscripts[0]["chapterNumber"] == 1
    assert manuscripts[1]["chapterName"] == "The Escape"
    assert manuscripts[1]["actNumber"] == 2
    assert manuscripts[1]["chapterNumber"] == 2


def test_build_project_data_uses_requested_manuscript_language_per_payload(monkeypatch) -> None:
    project_id = uuid4()

    outline = _outline(project_id=project_id, kind="outline", position=0, created_offset=0)
    act = _outline(project_id=project_id, kind="act", parent_id=outline.id, position=0, created_offset=1)
    chapter = _outline(project_id=project_id, kind="chapter", parent_id=act.id, position=0, created_offset=2)
    manuscript = Manuscript(id=uuid4(), chapter_id=chapter.id)

    db = _FakeDb(
        rows={
            BasicInfo: [],
            Guidelines: [],
            StoryEntity: [],
            Outline: [outline, act, chapter],
            Manuscript: [manuscript],
            ObjectVersion: [
                _object_version(
                    object_type="outline",
                    object_id=outline.id,
                    data={
                        "English": {"name": "Main Outline", "description": "Outline", "content": "Root"},
                        "Korean": {"name": "메인 아웃라인", "description": "개요", "content": "루트"},
                    },
                ),
                _object_version(
                    object_type="outline",
                    object_id=act.id,
                    data={
                        "English": {"name": "Act One", "description": "Act", "content": "Act content"},
                        "Korean": {"name": "1막", "description": "막", "content": "막 내용"},
                    },
                ),
                _object_version(
                    object_type="outline",
                    object_id=chapter.id,
                    data={
                        "English": {"name": "Chapter One", "description": "Chapter", "content": "Chapter content"},
                        "Korean": {"name": "1장", "description": "장", "content": "장 내용"},
                    },
                ),
                _object_version(
                    object_type="manuscript",
                    object_id=manuscript.id,
                    data={
                        "Korean": {"doc": {"markdown": "한국어 원고"}, "wordCount": 2},
                        "English": {"doc": {"markdown": "English manuscript"}, "wordCount": 2},
                    },
                ),
            ],
        },
        outlines=[outline, act, chapter],
    )

    _stub_story_entity_tree_helpers(monkeypatch)

    project = asyncio.run(build_project_data(db, project_id, "English", _FakeSidecar()))

    assert project["manuscripts"][0]["content"] == "English manuscript"
    assert project["manuscripts"][0]["wordCount"] == 2
    assert project["contentByLang"]["English"]["manuscripts"][0]["content"] == "English manuscript"
    assert project["contentByLang"]["Korean"]["manuscripts"][0]["content"] == "한국어 원고"
    assert project["manuscripts"][0]["chapterId"] == str(chapter.id)


def test_build_project_data_falls_back_when_requested_manuscript_language_has_no_doc(monkeypatch) -> None:
    project_id = uuid4()

    outline = _outline(project_id=project_id, kind="outline", position=0, created_offset=0)
    act = _outline(project_id=project_id, kind="act", parent_id=outline.id, position=0, created_offset=1)
    chapter = _outline(project_id=project_id, kind="chapter", parent_id=act.id, position=0, created_offset=2)
    manuscript = Manuscript(id=uuid4(), chapter_id=chapter.id)

    db = _FakeDb(
        rows={
            BasicInfo: [],
            Guidelines: [],
            StoryEntity: [],
            Outline: [outline, act, chapter],
            Manuscript: [manuscript],
            ObjectVersion: [
                _object_version(
                    object_type="outline",
                    object_id=outline.id,
                    data={"English": {"name": "Main Outline", "description": "Outline", "content": "Root"}},
                ),
                _object_version(
                    object_type="outline",
                    object_id=act.id,
                    data={"English": {"name": "Act One", "description": "Act", "content": "Act content"}},
                ),
                _object_version(
                    object_type="outline",
                    object_id=chapter.id,
                    data={"English": {"name": "Chapter One", "description": "Chapter", "content": "Chapter content"}},
                ),
                _object_version(
                    object_type="manuscript",
                    object_id=manuscript.id,
                    data={
                        "English": {"wordCount": 99},
                        "Korean": {"doc": {"markdown": "대체 원고"}, "wordCount": 2},
                    },
                ),
            ],
        },
        outlines=[outline, act, chapter],
    )

    _stub_story_entity_tree_helpers(monkeypatch)

    project = asyncio.run(build_project_data(db, project_id, "English", _FakeSidecar()))

    assert project["manuscripts"][0]["content"] == "대체 원고"
    assert project["manuscripts"][0]["wordCount"] == 2
