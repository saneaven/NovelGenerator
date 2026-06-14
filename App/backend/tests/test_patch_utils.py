from __future__ import annotations

from App.backend.services.patch_utils import apply_single_replacement


def test_apply_single_replacement_exact_match_succeeds() -> None:
    result = apply_single_replacement(
        "왕은 그를 바라보며 웃었다.",
        "그를 바라보며",
        "그를 차갑게 바라보며",
    )

    assert result.success is True
    assert result.content == "왕은 그를 차갑게 바라보며 웃었다."


def test_apply_single_replacement_rejects_empty_old() -> None:
    result = apply_single_replacement("content", "", "new")

    assert result.success is False
    assert result.code == "EMPTY_OLD_TEXT"


def test_patch_not_found_reports_expected_actual_for_replacement() -> None:
    result = apply_single_replacement(
        "제단 위에는 검은 봉인석이 놓여 있었다.",
        "제단 위에는 붉은 봉인석이 놓여 있었다.",
        "제단 위에는 푸른 봉인석이 놓여 있었다.",
    )

    assert result.success is False
    assert result.code == "PATCH_NOT_FOUND"
    assert result.reason == (
        'PATCH_NOT_FOUND\n'
        'expected="제단 위에는 붉은 봉인석이 놓여 있었다."\n'
        'actual="제단 위에는 검은 봉인석이 놓여 있었다."'
    )


def test_patch_not_found_reports_expected_actual_for_insertion() -> None:
    result = apply_single_replacement(
        "왕은 그를 잠시 바라보며 웃었다.",
        "왕은 그를 바라보며 웃었다.",
        "왕은 그를 차갑게 바라보며 웃었다.",
    )

    assert result.success is False
    assert result.reason == (
        'PATCH_NOT_FOUND\n'
        'expected="왕은 그를 바라보며 웃었다."\n'
        'actual="왕은 그를 잠시 바라보며 웃었다."'
    )


def test_patch_not_found_reports_expected_actual_for_deletion() -> None:
    result = apply_single_replacement(
        "제단 위에는 봉인석이 놓여 있었다.",
        "제단 위에는 검은 봉인석이 놓여 있었다.",
        "제단 위에는 푸른 봉인석이 놓여 있었다.",
    )

    assert result.success is False
    assert result.reason == (
        'PATCH_NOT_FOUND\n'
        'expected="제단 위에는 검은 봉인석이 놓여 있었다."\n'
        'actual="제단 위에는 봉인석이 놓여 있었다."'
    )


def test_patch_not_found_uses_minimal_sentence_in_long_paragraphs() -> None:
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
    assert 'expected="제단 위에는 붉은 봉인석이 놓여 있었다."' in str(result.reason)
    assert 'actual="제단 위에는 검은 봉인석이 놓여 있었다."' in str(result.reason)
    assert "하르덴은 성벽 아래에 서 있었다" not in str(result.reason)


def test_patch_not_found_without_reliable_match_stays_brief() -> None:
    result = apply_single_replacement(
        "비가 창문을 두드렸다. 방 안에는 아무도 없었다.",
        "용이 하늘을 가르며 포효했다.",
        "용이 검은 구름 사이로 사라졌다.",
    )

    assert result.success is False
    assert result.reason == "PATCH_NOT_FOUND\nno reliable close match"


def test_patch_not_unique_reports_match_count_without_context() -> None:
    result = apply_single_replacement("repeat repeat repeat", "repeat", "echo")

    assert result.success is False
    assert result.code == "PATCH_NOT_UNIQUE"
    assert result.reason == (
        "PATCH_NOT_UNIQUE\n"
        "matches=3\n"
        "old appears multiple times. Use a longer old string."
    )
    assert "expected=" not in str(result.reason)
    assert "actual=" not in str(result.reason)


def test_patch_failure_reason_has_bounded_length() -> None:
    content = "시작 " + ("가" * 240) + " 끝"
    old = "시작 " + ("나" * 240) + " 끝"

    result = apply_single_replacement(content, old, "replacement")

    assert result.success is False
    assert result.reason is not None
    assert len(result.reason) <= 500
