"""HTTP client for TipTap manuscript conversion sidecar."""

from __future__ import annotations

import os
from typing import Any

import httpx


class SidecarError(RuntimeError):
    """Base error for sidecar failures."""


class SidecarUnavailableError(SidecarError):
    """Raised when sidecar is unreachable or returns non-2xx responses."""


class SidecarConversionError(SidecarError):
    """Raised when conversion response is malformed."""


class SidecarClient:
    # NOTE: 600s timeout is intentional. TipTap doc-to-markdown conversion for
    # large manuscripts can take several minutes. Do not reduce this value.
    def __init__(self, base_url: str | None = None, timeout: float = 600.0):
        self.base_url = (base_url or os.getenv("SIDECAR_URL") or "http://localhost:3001").rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=timeout)

    async def close(self) -> None:
        await self._client.aclose()

    async def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        last_exc: Exception | None = None
        for _ in range(3):
            try:
                resp = await self._client.post(path, json=payload)
                if resp.status_code >= 400:
                    raise SidecarUnavailableError(f"sidecar {path} failed: {resp.status_code} {resp.text}")
                body = resp.json()
                if not isinstance(body, dict):
                    raise SidecarConversionError(f"sidecar {path} returned non-object response")
                return body
            except (httpx.HTTPError, ValueError, SidecarError) as exc:
                last_exc = exc
        raise SidecarUnavailableError(
            f"sidecar {path} failed after 3 retries: {type(last_exc).__name__}: {last_exc}"
            if last_exc else "sidecar request failed"
        ) from last_exc

    async def doc_to_markdown(self, doc: dict[str, Any]) -> str:
        body = await self._post_json("/doc-to-markdown", {"doc": doc})
        markdown = body.get("markdown")
        if not isinstance(markdown, str):
            raise SidecarConversionError("doc-to-markdown response missing 'markdown'")
        return markdown

    async def markdown_to_doc(self, markdown: str) -> dict[str, Any]:
        body = await self._post_json("/markdown-to-doc", {"markdown": markdown})
        doc = body.get("doc")
        if not isinstance(doc, dict):
            raise SidecarConversionError("markdown-to-doc response missing 'doc'")
        return doc


sidecar_client = SidecarClient()
