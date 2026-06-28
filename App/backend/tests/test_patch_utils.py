from __future__ import annotations

from xml.etree import ElementTree

from App.backend.services import patch_utils
from App.backend.services.patch_utils import apply_single_replacement


def _root(reason: str | None) -> ElementTree.Element:
    assert reason is not None
    root = ElementTree.fromstring(reason)
    assert root.tag == "patch_failure"
    return root


def _mismatches(root: ElementTree.Element) -> list[ElementTree.Element]:
    return root.findall("./mismatches/mismatch")


def _text(element: ElementTree.Element, name: str) -> str:
    return element.findtext(name) or ""


def test_apply_single_replacement_exact_match_succeeds() -> None:
    result = apply_single_replacement(
        "왕은 그를 바라보며 웃었다.",
        "그를 바라보며",
        "그를 차갑게 바라보며",
    )

    assert result.success is True
    assert result.content == "왕은 그를 차갑게 바라보며 웃었다."


def test_apply_single_replacement_rejects_empty_old_with_xml_reason() -> None:
    result = apply_single_replacement("content", "", "new")

    assert result.success is False
    assert result.code == "EMPTY_OLD_TEXT"
    root = _root(result.reason)
    assert root.attrib == {"code": "EMPTY_OLD_TEXT", "kind": "empty_old_text"}
    assert root.findtext("message") == "old text must not be empty."


def test_patch_not_found_reports_replacement_mismatch_block() -> None:
    result = apply_single_replacement(
        "제단 위에는 검은 봉인석이 놓여 있었다.",
        "제단 위에는 붉은 봉인석이 놓여 있었다.",
        "제단 위에는 푸른 봉인석이 놓여 있었다.",
    )

    assert result.success is False
    assert result.code == "PATCH_NOT_FOUND"
    root = _root(result.reason)
    assert root.attrib == {"code": "PATCH_NOT_FOUND", "kind": "target_mismatch"}
    [mismatch] = _mismatches(root)
    assert _text(mismatch, "before_context") == "제단 위에는 "
    assert _text(mismatch, "expected_block") == "붉"
    assert _text(mismatch, "actual_block") == "검"
    assert _text(mismatch, "after_context") == "은 봉인석이 놓여 있었다."


def test_patch_not_found_reports_insertion_mismatch_block() -> None:
    result = apply_single_replacement(
        "왕은 그를 잠시 바라보며 웃었다.",
        "왕은 그를 바라보며 웃었다.",
        "왕은 그를 차갑게 바라보며 웃었다.",
    )

    assert result.success is False
    root = _root(result.reason)
    assert root.attrib["kind"] == "target_mismatch"
    [mismatch] = _mismatches(root)
    assert _text(mismatch, "before_context") == "왕은 그를 "
    assert _text(mismatch, "expected_block") == ""
    assert _text(mismatch, "actual_block") == "잠시 "
    assert _text(mismatch, "after_context") == "바라보며 웃었다."


def test_patch_not_found_reports_deletion_mismatch_block() -> None:
    result = apply_single_replacement(
        "제단 위에는 봉인석이 놓여 있었다.",
        "제단 위에는 검은 봉인석이 놓여 있었다.",
        "제단 위에는 푸른 봉인석이 놓여 있었다.",
    )

    assert result.success is False
    root = _root(result.reason)
    assert root.attrib["kind"] == "target_mismatch"
    [mismatch] = _mismatches(root)
    assert _text(mismatch, "before_context") == "제단 위에는 "
    assert _text(mismatch, "expected_block") == "검은 "
    assert _text(mismatch, "actual_block") == ""
    assert _text(mismatch, "after_context") == "봉인석이 놓여 있었다."


def test_patch_not_found_uses_mismatch_block_in_long_paragraphs() -> None:
    content = "\n\n".join(
        [
            "하르덴은 성벽 아래에 서 있었다.\n비는 이미 그쳤다.",
            "문이 열리자 오래된 석실이 모습을 드러냈다.\n제단 위에는 검은 봉인석이 놓여 있었다.\n진동이 이어졌다.",
            '엘라는 그에게 손을 내밀었다.\n"늦었어. 이미 의식은 시작됐어."',
        ]
    )
    old = "\n\n".join(
        [
            "하르덴은 성벽 아래에 서 있었다.\n비는 이미 그쳤다.",
            "문이 열리자 오래된 석실이 모습을 드러냈다.\n제단 위에는 붉은 봉인석이 놓여 있었다.\n진동이 이어졌다.",
            '엘라는 그에게 손을 내밀었다.\n"늦었어. 이미 의식은 시작됐어."',
        ]
    )

    result = apply_single_replacement(content, old, "replacement")

    assert result.success is False
    root = _root(result.reason)
    [mismatch] = _mismatches(root)
    assert _text(mismatch, "expected_block") == "붉"
    assert _text(mismatch, "actual_block") == "검"
    assert "하르덴은 성벽 아래에 서 있었다" not in str(result.reason)


def test_patch_not_found_without_anchor_target_reports_target_not_found() -> None:
    result = apply_single_replacement(
        "비가 창문을 두드렸다. 방 안에는 아무도 없었다.",
        "용이 하늘을 가르며 포효했다.",
        "용이 검은 구름 사이로 사라졌다.",
    )

    assert result.success is False
    root = _root(result.reason)
    assert root.attrib == {"code": "PATCH_NOT_FOUND", "kind": "target_not_found"}
    assert "close match" not in str(result.reason)


def test_patch_not_unique_reports_ambiguous_xml_without_match_count() -> None:
    result = apply_single_replacement("repeat repeat repeat", "repeat", "echo")

    assert result.success is False
    assert result.code == "PATCH_NOT_UNIQUE"
    root = _root(result.reason)
    assert root.attrib == {"code": "PATCH_NOT_UNIQUE", "kind": "target_ambiguous"}
    assert "matches=" not in str(result.reason)
    assert "<patch_failures>" not in str(result.reason)


def test_patch_mismatch_recursively_splits_multiple_blocks() -> None:
    result = apply_single_replacement(
        "AAA 111 BBB 222 CCC 333 DDD",
        "AAA xxx BBB yyy CCC zzz DDD",
        "replacement",
    )

    assert result.success is False
    root = _root(result.reason)
    blocks = _mismatches(root)
    assert [(_text(block, "expected_block"), _text(block, "actual_block")) for block in blocks] == [
        ("xxx", "111"),
        ("yyy", "222"),
        ("zzz", "333"),
    ]


def test_patch_mismatch_recursion_limit_reports_current_block(monkeypatch) -> None:
    monkeypatch.setattr(patch_utils, "_MAX_MISMATCH_RECURSION_DEPTH", 0)

    result = apply_single_replacement(
        "AAA 111 BBB 222 CCC 333 DDD",
        "AAA xxx BBB yyy CCC zzz DDD",
        "replacement",
    )

    assert result.success is False
    root = _root(result.reason)
    [block] = _mismatches(root)
    assert _text(block, "expected_block") == "xxx BBB yyy CCC zzz"
    assert _text(block, "actual_block") == "111 BBB 222 CCC 333"


def test_patch_not_found_reports_ambiguous_target_when_anchor_chains_repeat() -> None:
    result = apply_single_replacement(
        "AAA 111 BBB AAA 222 BBB",
        "AAA xxx BBB",
        "replacement",
    )

    assert result.success is False
    root = _root(result.reason)
    assert root.attrib == {"code": "PATCH_NOT_FOUND", "kind": "target_ambiguous"}


def test_patch_failure_reason_escapes_xml_values() -> None:
    result = apply_single_replacement(
        "start A & B end",
        "start A < B end",
        "replacement",
    )

    assert result.success is False
    root = _root(result.reason)
    [mismatch] = _mismatches(root)
    assert _text(mismatch, "expected_block") == "<"
    assert _text(mismatch, "actual_block") == "&"
