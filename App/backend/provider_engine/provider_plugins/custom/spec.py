from __future__ import annotations

from ...contracts import (
    Condition,
    EmbeddingSpec,
    FieldSpec,
    LLMVariantSpec,
    LLMSpec,
    ObjectSpec,
    ProviderSpec,
    ProviderUI,
    RuntimeSpec,
    UIHint,
)


SPEC = ProviderSpec(
    id="custom",
    ui=ProviderUI(
        display_name_key="settings.credentials.custom.title",
        icon_key="custom",
        description_key="settings.taskConfig.providerDescriptions.custom",
        llm_order=60,
        embedding_order=40,
    ),
    credentials=ObjectSpec(fields={
        "base_url": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="text",
                label_key="settings.credentials.baseUrl",
                placeholder_key="settings.credentials.custom.baseUrlPlaceholder",
                help_key="settings.credentials.custom.baseUrlHint",
                order=10,
            ),
        ),
        "api_key": FieldSpec(
            kind="string",
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKeyOptional",
                placeholder_key="settings.credentials.custom.apiKeyPlaceholder",
                help_key="settings.credentials.custom.apiKeyHint",
                order=20,
            ),
        ),
        "additional_headers": FieldSpec(
            kind="object",
            ui=UIHint(
                widget="json",
                label_key="settings.credentials.custom.additionalHeaders",
                placeholder_key="settings.credentials.custom.additionalHeadersPlaceholder",
                help_key="settings.credentials.custom.additionalHeadersHint",
                order=30,
            ),
        ),
        "additional_body": FieldSpec(
            kind="object",
            ui=UIHint(
                widget="json",
                label_key="settings.credentials.custom.additionalBody",
                placeholder_key="settings.credentials.custom.additionalBodyPlaceholder",
                help_key="settings.credentials.custom.additionalBodyHint",
                order=40,
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="custom", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(kind="number", default=0.7, expose=False, min_value=0, max_value=2, step=0.1),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1, max_value=1000000),
            "context_window_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1024, max_value=1000000),
            "advanced": ObjectSpec(fields={
                "custom_kind": FieldSpec(
                    kind="enum",
                    default="openai_completion",
                    options=("openai_completion", "openai_response", "claude"),
                    ui=UIHint(
                        widget="select",
                        label_key="settings.taskConfig.customKind",
                        help_key="settings.taskConfig.customKindHint",
                        order=5,
                    ),
                ),
                "tokenizer_override": FieldSpec(
                    kind="enum",
                    options=("openai", "claude", "gemini"),
                    ui=UIHint(
                        widget="select",
                        label_key="settings.taskConfig.tokenizer",
                        help_key="settings.taskConfig.tokenizerHint",
                        order=8,
                    ),
                ),
                "thinking_mode": FieldSpec(
                    kind="enum",
                    default="off",
                    options=("off", "model", "custom"),
                    ui=UIHint(widget="radio_cards", label_key="settings.taskConfig.thinking_mode", order=10),
                ),
            }),
        }),
        variant_path="advanced.custom_kind",
        default_variant="openai_completion",
        variants={
            "openai_completion": LLMVariantSpec(
                id="openai_completion",
                runtime=RuntimeSpec(adapter="openai_completion"),
                task_config=ObjectSpec(fields={
                    "advanced": ObjectSpec(fields={
                        "custom_thinking_template_id": FieldSpec(
                            kind="string",
                            when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                            ui=UIHint(
                                widget="template_select",
                                label_key="settings.taskConfig.thinkingTemplate",
                                help_key="settings.taskConfig.thinkingTemplateHint",
                                order=20,
                            ),
                        ),
                    }),
                }),
            ),
            "openai_response": LLMVariantSpec(
                id="openai_response",
                runtime=RuntimeSpec(adapter="openai_response"),
                task_config=ObjectSpec(fields={
                    "advanced": ObjectSpec(fields={
                        "verbosity": FieldSpec(
                            kind="enum",
                            options=("low", "medium", "high"),
                            when=(Condition(op="regex", path="model", pattern=r"(?i)gpt-?5"),),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.taskConfig.thinking_config.verbosity",
                                help_key="settings.taskConfig.thinking_config.verbosityHint",
                                option_label_prefix="settings.taskConfig.thinking_config.verbosityOptions",
                                order=6,
                            ),
                        ),
                        "thinking_config": ObjectSpec(
                            when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                            fields={
                                "effort": FieldSpec(
                                    kind="enum",
                                    default="medium",
                                    options=("none", "minimal", "low", "medium", "high", "xhigh"),
                                    ui=UIHint(
                                        widget="select",
                                        label_key="settings.taskConfig.thinking_config.reasoningEffort",
                                        help_key="settings.taskConfig.thinking_config.effortHint",
                                        option_label_prefix="settings.taskConfig.thinking_config.effortOptions",
                                        order=20,
                                    ),
                                ),
                                "max_tokens": FieldSpec(
                                    kind="int",
                                    when=(
                                        Condition(op="eq", path="advanced.thinking_mode", value="model"),
                                        Condition(op="not_regex", path="model", pattern=r"(?i)gpt-?5"),
                                    ),
                                    min_value=1024,
                                    max_value=32000,
                                    ui=UIHint(
                                        widget="number",
                                        label_key="settings.taskConfig.thinking_config.maxThinkingTokens",
                                        placeholder_key="settings.taskConfig.thinking_config.maxThinkingTokensPlaceholder",
                                        help_key="settings.taskConfig.thinking_config.maxThinkingTokensHint",
                                        order=30,
                                    ),
                                ),
                            },
                        ),
                    }),
                }),
            ),
            "claude": LLMVariantSpec(
                id="claude",
                runtime=RuntimeSpec(adapter="claude"),
                task_config=ObjectSpec(fields={
                    "advanced": ObjectSpec(fields={
                        "thinking_config": ObjectSpec(
                            when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                            fields={
                                "effort": FieldSpec(
                                    kind="enum",
                                    default="high",
                                    options=("low", "medium", "high", "max"),
                                    ui=UIHint(
                                        widget="select",
                                        label_key="settings.taskConfig.thinking_config.effortLevel",
                                        help_key="settings.taskConfig.thinking_config.effortHintGeneric",
                                        option_label_prefix="settings.taskConfig.thinking_config.effortOptions",
                                        order=20,
                                    ),
                                ),
                            },
                        ),
                    }),
                }),
            ),
        },
        supports_tools=True,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="custom", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
)
