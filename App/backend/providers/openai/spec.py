from __future__ import annotations

from ..shared.contracts import (
    Condition,
    EmbeddingSpec,
    FieldSpec,
    ImageModelDescriptor,
    ImageModelGeometrySpec,
    ImageSpec,
    LLMVariantSpec,
    LLMSpec,
    ObjectSpec,
    ProviderSpec,
    ProviderUI,
    RuntimeSpec,
    UIHint,
)

OPENAI_DEFAULT_MODEL = "gpt-image-2"
OPENAI_SUPPORTED_ASPECT_RATIOS = (
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)
OPENAI_SUPPORTED_RESOLUTIONS = ("1K", "2K", "4K")


SPEC = ProviderSpec(
    id="openai",
    ui=ProviderUI(
        display_name_key="settings.credentials.openai.title",
        icon_key="openai",
        description_key="settings.taskConfig.providerDescriptions.openai",
        llm_order=10,
        embedding_order=10,
        image_order=10,
        model_browser_grouping_llm="openai_series",
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.openai.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://platform.openai.com/api-keys",
                link_label="platform.openai.com/api-keys",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="openai", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(kind="number", default=0.7, expose=False, min_value=0, max_value=2, step=0.1),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1, max_value=1000000),
            "context_window_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1024, max_value=1000000),
            "supports_image_input": FieldSpec(kind="bool", default=True, expose=False),
            "advanced": ObjectSpec(fields={
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
                            ui=UIHint(
                                widget="number",
                                label_key="settings.taskConfig.thinking_config.maxThinkingTokens",
                                placeholder_key="settings.taskConfig.thinking_config.maxThinkingTokensPlaceholder",
                                help_key="settings.taskConfig.thinking_config.maxThinkingTokensHint",
                                order=30,
                            ),
                            min_value=1024,
                            max_value=32000,
                        ),
                    },
                ),
                "verbosity": FieldSpec(
                    kind="enum",
                    options=("low", "medium", "high"),
                    when=(Condition(op="regex", path="model", pattern=r"(?i)gpt-?5"),),
                    ui=UIHint(
                        widget="select",
                        label_key="settings.taskConfig.thinking_config.verbosity",
                        help_key="settings.taskConfig.thinking_config.verbosityHint",
                        option_label_prefix="settings.taskConfig.thinking_config.verbosityOptions",
                        order=5,
                    ),
                ),
                "provider_settings": ObjectSpec(fields={
                    "cache": ObjectSpec(fields={
                        "enabled": FieldSpec(
                            kind="bool",
                            default=True,
                            ui=UIHint(
                                widget="toggle",
                                label_key="settings.llmCache.fields.enabled",
                                help_key="settings.llmCache.fields.openaiEnabledHint",
                                order=10,
                            ),
                        ),
                        "retention": FieldSpec(
                            kind="enum",
                            default="default",
                            options=("default", "in_memory", "24h"),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.llmCache.fields.retention",
                                option_label_prefix="settings.llmCache.options.openaiRetention",
                                order=20,
                            ),
                        ),
                    }),
                }),
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
        supports_tools=False,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="openai", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
    image=ImageSpec(
        runtime=RuntimeSpec(adapter="default"),
        prompt_type="natural",
        supports_image_input=True,
        catalog_cache_policy="static",
        settings_title_key="settings.imageGen.openaiSettings.title",
        settings_description_key="settings.imageGen.openaiSettings.description",
        provider_settings=ObjectSpec(fields={
            "quality": FieldSpec(
                kind="enum",
                default="medium",
                options=("auto", "low", "medium", "high"),
                ui=UIHint(
                    widget="select",
                    label_key="settings.imageGen.openaiSettings.quality",
                    help_key="settings.imageGen.openaiSettings.qualityHint",
                    option_label_prefix="settings.imageGen.openaiSettings.qualityOptions",
                    order=10,
                ),
            ),
            "background": FieldSpec(
                kind="enum",
                default="auto",
                options=("auto", "opaque"),
                ui=UIHint(
                    widget="select",
                    label_key="settings.imageGen.openaiSettings.background",
                    help_key="settings.imageGen.openaiSettings.backgroundHint",
                    option_label_prefix="settings.imageGen.openaiSettings.backgroundOptions",
                    order=20,
                ),
            ),
            "output_format": FieldSpec(
                kind="enum",
                default="png",
                options=("png", "jpeg", "webp"),
                ui=UIHint(
                    widget="select",
                    label_key="settings.imageGen.openaiSettings.format",
                    help_key="settings.imageGen.openaiSettings.formatHint",
                    option_label_prefix="settings.imageGen.openaiSettings.formatOptions",
                    order=30,
                ),
            ),
            "output_compression": FieldSpec(
                kind="int",
                default=90,
                min_value=0,
                max_value=100,
                disabled_when=(Condition(op="eq", path="output_format", value="png"),),
                ui=UIHint(
                    widget="number",
                    label_key="settings.imageGen.openaiSettings.compression",
                    help_key="settings.imageGen.openaiSettings.compressionHint",
                    order=40,
                ),
            ),
            "moderation": FieldSpec(
                kind="enum",
                default="auto",
                options=("auto", "low"),
                ui=UIHint(
                    widget="select",
                    label_key="settings.imageGen.openaiSettings.moderation",
                    help_key="settings.imageGen.openaiSettings.moderationHint",
                    option_label_prefix="settings.imageGen.openaiSettings.moderationOptions",
                    order=50,
                ),
            ),
        }),
        models=(
            ImageModelDescriptor(
                id=OPENAI_DEFAULT_MODEL,
                name="GPT Image 2",
                prompt_type="natural",
                supports_image_input=True,
                supports_mask_input=True,
                supports_multi_image_input=True,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=OPENAI_SUPPORTED_ASPECT_RATIOS,
                    supported_resolutions=OPENAI_SUPPORTED_RESOLUTIONS,
                    default_aspect_ratio="1:1",
                    default_resolution="1K",
                    resolution_mode="native_tier",
                    supported_geometry_pairs={
                        ratio: OPENAI_SUPPORTED_RESOLUTIONS
                        for ratio in OPENAI_SUPPORTED_ASPECT_RATIOS
                    },
                ),
                description="Flexible OpenAI image model for generation, multi-image edits, and masking. 4K output is experimental.",
                tags=("latest", "4k-experimental"),
                category="image",
                architecture={
                    "input_modalities": ["text", "image"],
                    "output_modalities": ["image"],
                },
                capabilities={
                    "text_to_image": True,
                    "image_to_image": True,
                    "masking": True,
                    "multi_image_edit": True,
                    "flexible_resolution": True,
                    "experimental_4k": True,
                },
                supported_parameters={
                    "aspect_ratios": list(OPENAI_SUPPORTED_ASPECT_RATIOS),
                    "resolutions": list(OPENAI_SUPPORTED_RESOLUTIONS),
                    "quality": ["auto", "low", "medium", "high"],
                    "background": ["auto", "opaque"],
                    "output_format": ["png", "jpeg", "webp"],
                    "moderation": ["auto", "low"],
                    "experimental_resolutions": ["4K"],
                },
            ),
        ),
    ),
)
