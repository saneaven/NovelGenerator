from __future__ import annotations

from ..shared.contracts import (
    Condition,
    EmbeddingSpec,
    FieldSpec,
    ImageSpec,
    LLMVariantSpec,
    LLMSpec,
    ObjectSpec,
    ProviderSpec,
    ProviderUI,
    RuntimeSpec,
    UIHint,
)


SPEC = ProviderSpec(
    id="openrouter",
    ui=ProviderUI(
        display_name_key="settings.credentials.openrouter.title",
        icon_key="openrouter",
        description_key="settings.taskConfig.providerDescriptions.openrouter",
        llm_order=40,
        embedding_order=30,
        image_order=50,
        model_browser_grouping_llm="provider_family",
        model_browser_grouping_embedding="provider_family",
        llm_show_architecture=True,
        llm_show_pricing=True,
        llm_show_endpoints=True,
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.openrouter.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://openrouter.ai/keys",
                link_label="openrouter.ai/keys",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="openrouter", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(kind="number", default=0.7, expose=False, min_value=0, max_value=2, step=0.1),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1, max_value=1000000),
            "context_window_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1024, max_value=1000000),
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
                    ui=UIHint(widget="radio_cards", label_key="settings.taskConfig.thinking_mode", order=10),
                ),
                "provider_settings": ObjectSpec(fields={
                    "service_tier": FieldSpec(
                        kind="enum",
                        options=("default", "flex", "priority"),
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
                            default="medium",
                            options=("minimal", "low", "medium", "high", "xhigh", "max"),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.taskConfig.thinking_config.effortLevel",
                                help_key="settings.taskConfig.thinking_config.effortHintGeneric",
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
            )
        },
        default_variant="default",
        supports_tools=True,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="openrouter", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
    image=ImageSpec(
        runtime=RuntimeSpec(
            adapter="default",
            server_only={
                "fallback_aspect_ratios": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"],
                "fallback_resolutions": ["512px", "1K", "2K", "4K"],
            },
        ),
        prompt_format="natural",
        supports_image_input=False,
        models_adapter="dynamic",
        catalog_cache_policy="none",
    ),
)
