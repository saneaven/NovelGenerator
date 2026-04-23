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

GEMINI_FLASH_IMAGE_ASPECT_RATIOS = (
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
    "1:4",
    "4:1",
    "1:8",
    "8:1",
)
GEMINI_PRO_IMAGE_ASPECT_RATIOS = (
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
GEMINI_FLASH_IMAGE_SIZES = ("512px", "1K", "2K", "4K")
GEMINI_PRO_IMAGE_SIZES = ("1K", "2K", "4K")


SPEC = ProviderSpec(
    id="gemini",
    ui=ProviderUI(
        display_name_key="settings.credentials.gemini.title",
        icon_key="gemini",
        description_key="settings.taskConfig.providerDescriptions.gemini",
        llm_order=20,
        embedding_order=20,
        image_order=20,
        model_browser_grouping_llm="gemini_family",
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.gemini.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://aistudio.google.com/apikey",
                link_label="aistudio.google.com/apikey",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="gemini", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(kind="number", default=0.7, expose=False, min_value=0, max_value=2, step=0.1),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1, max_value=1000000),
            "context_window_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1024, max_value=1000000),
            "advanced": ObjectSpec(fields={
                "thinking_mode": FieldSpec(
                    kind="enum",
                    default="model",
                    options=("off", "model", "custom"),
                    disabled_options=("off",),
                    ui=UIHint(
                        widget="radio_cards",
                        label_key="settings.taskConfig.thinking_mode",
                        order=10,
                    ),
                ),
                "thinking_config": ObjectSpec(
                    when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                    fields={
                        "gemini_thinking_level": FieldSpec(
                            kind="enum",
                            default="high",
                            options=("low", "high"),
                            when=(
                                Condition(op="eq", path="advanced.thinking_mode", value="model"),
                                Condition(op="regex", path="model", pattern=r"(?i)gemini-3"),
                            ),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.taskConfig.thinking_config.thinkingLevelGemini3",
                                help_key="settings.taskConfig.thinking_config.thinkingLevelGemini3Hint",
                                order=20,
                            ),
                        ),
                        "gemini_budget_tokens": FieldSpec(
                            kind="int",
                            when=(
                                Condition(op="eq", path="advanced.thinking_mode", value="model"),
                                Condition(op="regex", path="model", pattern=r"2\.5"),
                            ),
                            min_value=0,
                            ui=UIHint(
                                widget="number",
                                label_key="settings.taskConfig.thinking_config.thinkingBudget25",
                                placeholder_key="settings.taskConfig.thinking_config.thinkingBudget25Placeholder",
                                help_key="settings.taskConfig.thinking_config.thinkingBudget25Hint",
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
            )
        },
        default_variant="default",
        supports_tools=True,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="gemini", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
    image=ImageSpec(
        runtime=RuntimeSpec(adapter="default"),
        prompt_type="natural",
        supports_image_input=True,
        catalog_cache_policy="static",
        models=(
            ImageModelDescriptor(
                id="gemini-3.1-flash-image-preview",
                name="Gemini 3.1 Flash Image Preview",
                prompt_type="natural",
                supports_image_input=True,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=GEMINI_FLASH_IMAGE_ASPECT_RATIOS,
                    supported_resolutions=GEMINI_FLASH_IMAGE_SIZES,
                    default_aspect_ratio="1:1",
                    default_resolution="1K",
                    resolution_mode="native_tier",
                ),
            ),
            ImageModelDescriptor(
                id="gemini-3-pro-image-preview",
                name="Gemini 3 Pro Image Preview",
                prompt_type="natural",
                supports_image_input=True,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=GEMINI_PRO_IMAGE_ASPECT_RATIOS,
                    supported_resolutions=GEMINI_PRO_IMAGE_SIZES,
                    default_aspect_ratio="1:1",
                    default_resolution="1K",
                    resolution_mode="native_tier",
                ),
            ),
        ),
    ),
)
