from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys
import types
from uuid import uuid4

import pytest
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


_install_import_stubs()

import App.backend.services.fragment_service as fragment_service_module
from App.backend.models.db_models import PromptFragment
from App.backend.services.fragment_service import FragmentConflictError, FragmentService


def _fragment(
    *,
    fragment_name: str,
    version_number: int,
    content: str,
    description: str | None,
    user_id,
    preset_id,
) -> PromptFragment:
    created_at = datetime.utcnow() - timedelta(minutes=version_number)
    return PromptFragment(
        id=uuid4(),
        user_id=user_id,
        preset_id=preset_id,
        folder_id=None,
        fragment_name=fragment_name,
        content=content,
        description=description,
        version_number=version_number,
        note=f"v{version_number}",
        created_at=created_at,
        updated_at=created_at,
    )


def _operand_value(operand, row: PromptFragment):
    name = getattr(operand, "name", None)
    if name and hasattr(row, name):
        return getattr(row, name)
    if isinstance(operand, BindParameter):
        return operand.value
    if operand.__class__.__name__ == "Null":
        return None
    return operand


def _matches(row: PromptFragment, criterion) -> bool:
    if isinstance(criterion, BooleanClauseList):
        op_name = getattr(criterion.operator, "__name__", "")
        if op_name == "and_":
            return all(_matches(row, clause) for clause in criterion.clauses)
        raise AssertionError(f"Unsupported boolean operator: {criterion.operator!r}")

    if isinstance(criterion, BinaryExpression):
        left = _operand_value(criterion.left, row)
        right = _operand_value(criterion.right, row)
        op_name = getattr(criterion.operator, "__name__", "")
        if op_name == operators.eq.__name__:
            return left == right
        if op_name == operators.is_.__name__:
            return left is right
        raise AssertionError(f"Unsupported binary operator: {criterion.operator!r}")

    raise AssertionError(f"Unsupported criterion: {criterion!r}")


class _FakeQuery:
    def __init__(self, db: "_FakeDb", model) -> None:
        self._db = db
        self._model = model
        self._criteria: list[object] = []
        self._order_by: list[object] = []

    def filter(self, *criteria) -> "_FakeQuery":
        self._criteria.extend(criteria)
        return self

    def order_by(self, *expressions) -> "_FakeQuery":
        self._order_by.extend(expressions)
        return self

    def all(self) -> list[PromptFragment]:
        rows = [row for row in self._db.fragments if all(_matches(row, criterion) for criterion in self._criteria)]
        for expression in reversed(self._order_by):
            column = getattr(getattr(expression, "element", None), "name", None) or getattr(expression, "name", None)
            if not column:
                raise AssertionError(f"Unsupported order expression: {expression!r}")
            reverse = isinstance(expression, UnaryExpression) and getattr(expression.modifier, "__name__", "") == "desc_op"
            rows.sort(key=lambda row: getattr(row, column), reverse=reverse)
        return rows

    def first(self) -> PromptFragment | None:
        rows = self.all()
        return rows[0] if rows else None


class _FakeDb:
    def __init__(self, fragments: list[PromptFragment]) -> None:
        self.fragments = list(fragments)
        self.commits = 0
        self.flushes = 0

    def query(self, model):
        if model is not PromptFragment:
            raise AssertionError(f"Unsupported model query: {model!r}")
        return _FakeQuery(self, model)

    def add(self, row: PromptFragment) -> None:
        self.fragments.append(row)

    def flush(self) -> None:
        self.flushes += 1

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, _row: PromptFragment) -> None:
        return None


@pytest.fixture(autouse=True)
def _stub_folder_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fragment_service_module.FolderService, "build_folder_path_cache", lambda *_args, **_kwargs: {})


def test_update_fragment_rename_only_updates_existing_versions_without_creating_new_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    preset_id = uuid4()
    db = _FakeDb(
        [
            _fragment(fragment_name="scene", version_number=1, content="draft", description="desc", user_id=user_id, preset_id=preset_id),
            _fragment(fragment_name="scene", version_number=2, content="latest", description="desc", user_id=user_id, preset_id=preset_id),
        ]
    )

    ref_update_called = False

    def _unexpected_reference_update(*_args, **_kwargs) -> None:
        nonlocal ref_update_called
        ref_update_called = True

    monkeypatch.setattr(fragment_service_module, "update_template_references", _unexpected_reference_update)

    result = FragmentService.update_fragment(
        db=db,
        user_id=user_id,
        preset_id=preset_id,
        folder_id=None,
        fragment_name="scene",
        content="latest",
        description="desc",
        new_fragment_name="scene_renamed",
    )

    assert result is not None
    assert result.fragment_name == "scene_renamed"
    assert result.version_number == 2
    assert len(db.fragments) == 2
    assert {row.fragment_name for row in db.fragments} == {"scene_renamed"}
    assert db.commits == 1
    assert ref_update_called is False


def test_update_fragment_rename_and_content_change_creates_new_version_under_new_name() -> None:
    user_id = uuid4()
    preset_id = uuid4()
    db = _FakeDb(
        [
            _fragment(fragment_name="scene", version_number=1, content="draft", description="desc", user_id=user_id, preset_id=preset_id),
            _fragment(fragment_name="scene", version_number=2, content="latest", description="desc", user_id=user_id, preset_id=preset_id),
        ]
    )

    result = FragmentService.update_fragment(
        db=db,
        user_id=user_id,
        preset_id=preset_id,
        folder_id=None,
        fragment_name="scene",
        content="rewritten",
        description="desc",
        new_fragment_name="scene_renamed",
    )

    assert result is not None
    assert result.fragment_name == "scene_renamed"
    assert result.version_number == 3
    assert len(db.fragments) == 3
    assert {row.fragment_name for row in db.fragments} == {"scene_renamed"}
    newest = max(db.fragments, key=lambda row: row.version_number)
    assert newest.content == "rewritten"
    assert newest.fragment_name == "scene_renamed"


def test_update_fragment_rename_conflict_raises_fragment_conflict_error() -> None:
    user_id = uuid4()
    preset_id = uuid4()
    db = _FakeDb(
        [
            _fragment(fragment_name="scene", version_number=1, content="draft", description="desc", user_id=user_id, preset_id=preset_id),
            _fragment(fragment_name="scene", version_number=2, content="latest", description="desc", user_id=user_id, preset_id=preset_id),
            _fragment(fragment_name="taken", version_number=1, content="other", description=None, user_id=user_id, preset_id=preset_id),
        ]
    )

    with pytest.raises(FragmentConflictError, match="Fragment already exists: taken"):
        FragmentService.update_fragment(
            db=db,
            user_id=user_id,
            preset_id=preset_id,
            folder_id=None,
            fragment_name="scene",
            content="latest",
            description="desc",
            new_fragment_name="taken",
        )

    assert len(db.fragments) == 3
    assert max(row.version_number for row in db.fragments) == 2
