from __future__ import annotations

from ..shared.contracts import (
    Condition,
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
    id="neuralwatt",
    ui=ProviderUI(
        display_name_key="settings.credentials.neuralwatt.title",
        icon_key="neuralwatt",
        description_key="settings.taskConfig.providerDescriptions.neuralwatt",
        llm_order=65,
        model_browser_grouping_llm="flat",
        llm_show_pricing=True,
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.neuralwatt.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://portal.neuralwatt.com/",
                link_label="portal.neuralwatt.com",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="neuralwatt", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(
                kind="number",
                default=0.7,
                expose=False,
                min_value=0,
                max_value=2,
                step=0.1,
            ),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(
                kind="int",
                default=None,
                expose=False,
                min_value=1,
                max_value=1000000,
            ),
            "context_window_tokens": FieldSpec(
                kind="int",
                default=None,
                expose=False,
                min_value=1024,
                max_value=1000000,
            ),
            "supports_image_input": FieldSpec(kind="bool", default=True, expose=False),
            "advanced": ObjectSpec(fields={
                "tokenizer_override": FieldSpec(
                    kind="enum",
                    options=("openai", "claude", "gemini"),
                    ui=UIHint(
                        widget="select",
                        label_key="settings.taskConfig.tokenizer",
                        help_key="settings.taskConfig.tokenizerHint",
                        order=5,
                    ),
                ),
                "thinking_mode": FieldSpec(
                    kind="enum",
                    default="off",
                    options=("off", "model", "custom"),
                    ui=UIHint(
                        widget="radio_cards",
                        label_key="settings.taskConfig.thinking_mode",
                        order=10,
                    ),
                ),
                "provider_settings": ObjectSpec(fields={
                    "service_tier": FieldSpec(
                        kind="enum",
                        options=("default", "flex"),
                        ui=UIHint(
                            widget="select",
                            label_key="settings.taskConfig.serviceTier.label",
                            help_key="settings.taskConfig.serviceTier.hint",
                            option_label_prefix="settings.taskConfig.serviceTier.options",
                            order=5,
                        ),
                    ),
                }),
                "thinking_config": ObjectSpec(
                    when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                    fields={
                        "effort": FieldSpec(
                            kind="enum",
                            options=("none", "minimal", "low", "medium", "high", "xhigh", "max"),
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
        variants={
            "default": LLMVariantSpec(
                id="default",
                runtime=RuntimeSpec(adapter="default"),
                task_config=ObjectSpec(fields={}),
                tokenizer="openai",
            ),
        },
        default_variant="default",
        supports_tools=True,
        supports_thinking=True,
    ),
)
