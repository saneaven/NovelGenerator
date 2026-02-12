"""Normalize task_configs naming to snake_case.

Revision ID: 0003_normalize_task_config_naming
Revises: 0002_add_sub_agent_invocation_logs
Create Date: 2026-02-11
"""

from __future__ import annotations

import json
from typing import Any, Dict

from alembic import op
import sqlalchemy as sa


revision = "0003_normalize_task_config_naming"
down_revision = "0002_add_sub_agent_invocation_logs"
branch_labels = None
depends_on = None


def _normalize_thinking_config_to_snake(thinking: Any) -> Any:
    if not isinstance(thinking, dict):
        return thinking

    out = dict(thinking)
    if "maxTokens" in out and "max_tokens" not in out:
        out["max_tokens"] = out.pop("maxTokens")
    if "claudeBudgetTokens" in out and "claude_budget_tokens" not in out:
        out["claude_budget_tokens"] = out.pop("claudeBudgetTokens")
    if "geminiThinkingLevel" in out and "gemini_thinking_level" not in out:
        out["gemini_thinking_level"] = out.pop("geminiThinkingLevel")
    if "geminiBudgetTokens" in out and "gemini_budget_tokens" not in out:
        out["gemini_budget_tokens"] = out.pop("geminiBudgetTokens")
    return out


def _normalize_advanced_to_snake(advanced: Any) -> Any:
    if not isinstance(advanced, dict):
        return advanced

    out = dict(advanced)
    if "enablePrefill" in out and "enable_prefill" not in out:
        out["enable_prefill"] = out.pop("enablePrefill")
    if "thinkingMode" in out and "thinking_mode" not in out:
        out["thinking_mode"] = out.pop("thinkingMode")
    if "thinkingConfig" in out and "thinking_config" not in out:
        out["thinking_config"] = out.pop("thinkingConfig")
    if "customApiFormat" in out and "thinking_format" not in out:
        out["thinking_format"] = out.pop("customApiFormat")
    if "tokenizerOverride" in out and "tokenizer_override" not in out:
        out["tokenizer_override"] = out.pop("tokenizerOverride")

    if "thinking_config" in out:
        out["thinking_config"] = _normalize_thinking_config_to_snake(out["thinking_config"])

    out.setdefault("request_format", "openai_sdk")
    out.setdefault("thinking_format", "openai")
    return out


def _normalize_task_configs_to_snake(task_configs: Any) -> Any:
    if not isinstance(task_configs, dict):
        return task_configs

    out: Dict[str, Any] = {}
    for task_key, task_cfg in task_configs.items():
        if not isinstance(task_cfg, dict):
            out[task_key] = task_cfg
            continue

        cfg = dict(task_cfg)
        if "providerPreference" in cfg and "provider_preference" not in cfg:
            cfg["provider_preference"] = cfg.pop("providerPreference")
        if "maxOutputTokens" in cfg and "max_output_tokens" not in cfg:
            cfg["max_output_tokens"] = cfg.pop("maxOutputTokens")
        if "contextWindowTokens" in cfg and "context_window_tokens" not in cfg:
            cfg["context_window_tokens"] = cfg.pop("contextWindowTokens")
        if "advanced" in cfg:
            cfg["advanced"] = _normalize_advanced_to_snake(cfg["advanced"])
        out[task_key] = cfg
    return out


def _normalize_thinking_config_to_camel(thinking: Any) -> Any:
    if not isinstance(thinking, dict):
        return thinking

    out = dict(thinking)
    if "max_tokens" in out and "maxTokens" not in out:
        out["maxTokens"] = out.pop("max_tokens")
    if "claude_budget_tokens" in out and "claudeBudgetTokens" not in out:
        out["claudeBudgetTokens"] = out.pop("claude_budget_tokens")
    if "gemini_thinking_level" in out and "geminiThinkingLevel" not in out:
        out["geminiThinkingLevel"] = out.pop("gemini_thinking_level")
    if "gemini_budget_tokens" in out and "geminiBudgetTokens" not in out:
        out["geminiBudgetTokens"] = out.pop("gemini_budget_tokens")
    return out


def _normalize_advanced_to_camel(advanced: Any) -> Any:
    if not isinstance(advanced, dict):
        return advanced

    out = dict(advanced)
    if "enable_prefill" in out and "enablePrefill" not in out:
        out["enablePrefill"] = out.pop("enable_prefill")
    if "thinking_mode" in out and "thinkingMode" not in out:
        out["thinkingMode"] = out.pop("thinking_mode")
    if "thinking_config" in out and "thinkingConfig" not in out:
        out["thinkingConfig"] = out.pop("thinking_config")
    if "thinking_format" in out and "customApiFormat" not in out:
        out["customApiFormat"] = out.pop("thinking_format")
    if "tokenizer_override" in out and "tokenizerOverride" not in out:
        out["tokenizerOverride"] = out.pop("tokenizer_override")
    out.pop("request_format", None)

    if "thinkingConfig" in out:
        out["thinkingConfig"] = _normalize_thinking_config_to_camel(out["thinkingConfig"])

    return out


def _normalize_task_configs_to_camel(task_configs: Any) -> Any:
    if not isinstance(task_configs, dict):
        return task_configs

    out: Dict[str, Any] = {}
    for task_key, task_cfg in task_configs.items():
        if not isinstance(task_cfg, dict):
            out[task_key] = task_cfg
            continue

        cfg = dict(task_cfg)
        if "provider_preference" in cfg and "providerPreference" not in cfg:
            cfg["providerPreference"] = cfg.pop("provider_preference")
        if "max_output_tokens" in cfg and "maxOutputTokens" not in cfg:
            cfg["maxOutputTokens"] = cfg.pop("max_output_tokens")
        if "context_window_tokens" in cfg and "contextWindowTokens" not in cfg:
            cfg["contextWindowTokens"] = cfg.pop("context_window_tokens")
        if "advanced" in cfg:
            cfg["advanced"] = _normalize_advanced_to_camel(cfg["advanced"])
        out[task_key] = cfg
    return out


def _rewrite_all_rows(normalizer) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, task_configs FROM user_settings")).fetchall()
    for row in rows:
        normalized = normalizer(row.task_configs)
        bind.execute(
            sa.text("UPDATE user_settings SET task_configs = CAST(:cfg AS jsonb) WHERE id = :id"),
            {"id": str(row.id), "cfg": json.dumps(normalized)},
        )


def upgrade() -> None:
    _rewrite_all_rows(_normalize_task_configs_to_snake)


def downgrade() -> None:
    _rewrite_all_rows(_normalize_task_configs_to_camel)
