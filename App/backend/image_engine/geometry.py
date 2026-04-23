from __future__ import annotations

from typing import Any

from .contracts import ResolvedGeometry
from ..provider_engine.contracts import ImageModelDescriptor


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a or 1


def normalize_ratio_text(raw: Any, *, fallback: str = "1:1") -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback
    for sep in (":", "/", "x"):
        if sep not in text:
            continue
        left, right = text.split(sep, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return fallback
        if width <= 0 or height <= 0:
            return fallback
        divisor = _gcd(width, height)
        return f"{width // divisor}:{height // divisor}"
    return fallback


def aspect_ratio_from_size(size: str, *, fallback: str = "1:1") -> str:
    text = str(size or "").strip().lower()
    if "x" not in text:
        return fallback
    left, right = text.split("x", 1)
    try:
        width = int(left)
        height = int(right)
    except ValueError:
        return fallback
    if width <= 0 or height <= 0:
        return fallback
    divisor = _gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _ratio_value(raw: str) -> float:
    normalized = normalize_ratio_text(raw)
    left, right = normalized.split(":")
    return int(left) / int(right)


def _pick_ratio(candidates: list[str], requested: str, *, fallback: str) -> str:
    if not candidates:
        return fallback
    normalized_requested = normalize_ratio_text(requested, fallback=fallback)
    if normalized_requested in candidates:
        return normalized_requested
    return min(
        candidates,
        key=lambda candidate: abs(_ratio_value(candidate) - _ratio_value(normalized_requested)),
    )


def resolve_descriptor_geometry(
    descriptor: ImageModelDescriptor,
    *,
    requested_aspect_ratio: str,
    requested_image_size: str,
) -> ResolvedGeometry:
    geometry = descriptor.geometry
    supported_sizes = list(geometry.supported_resolutions)
    supported_pairs = {
        key: list(value)
        for key, value in (geometry.supported_geometry_pairs or {}).items()
    }

    requested_ratio = normalize_ratio_text(
        requested_aspect_ratio,
        fallback=geometry.default_aspect_ratio,
    )
    requested_size = (
        str(requested_image_size or geometry.default_resolution).strip()
        or geometry.default_resolution
    )

    if geometry.resolution_mode == "native_exact":
        resolved_image_size = (
            requested_size if requested_size in supported_sizes else geometry.default_resolution
        )
        resolved_ratio = aspect_ratio_from_size(
            resolved_image_size,
            fallback=geometry.default_aspect_ratio,
        )
        resolved_native_size = resolved_image_size
    else:
        resolved_ratio = _pick_ratio(
            list(geometry.supported_aspect_ratios),
            requested_ratio,
            fallback=geometry.default_aspect_ratio,
        )
        allowed_sizes = supported_pairs.get(resolved_ratio) or supported_sizes or [geometry.default_resolution]
        resolved_image_size = (
            requested_size
            if requested_size in allowed_sizes
            else (
                geometry.default_resolution
                if geometry.default_resolution in allowed_sizes
                else allowed_sizes[0]
            )
        )
        if geometry.resolution_mode == "translated_fixed":
            native_size_by_ratio = geometry.native_size_by_ratio or {}
            resolved_native_size = (
                native_size_by_ratio.get(resolved_ratio)
                or next(iter(native_size_by_ratio.values()), resolved_image_size)
            )
        else:
            resolved_native_size = resolved_image_size

    return ResolvedGeometry(
        requested_aspect_ratio=normalize_ratio_text(
            requested_aspect_ratio,
            fallback=resolved_ratio,
        ),
        requested_image_size=(
            str(requested_image_size or resolved_image_size).strip()
            or resolved_image_size
        ),
        resolved_aspect_ratio=resolved_ratio,
        resolved_image_size=resolved_image_size,
        resolved_native_size=resolved_native_size,
    )
