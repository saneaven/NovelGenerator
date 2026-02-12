"""Utilities for securing outbound HTTP requests (SSRF hardening)."""

from __future__ import annotations

import json
import ipaddress
import socket
from typing import Any, Dict, Iterable, Optional
from urllib.parse import urlsplit, urlunsplit


_DISALLOWED_HOST_SUFFIXES = (
    ".local",
    ".localhost",
    ".internal",
)

_DISALLOWED_HOSTS = {
    "localhost",
}

_DISALLOWED_HEADER_NAMES = {
    # hop-by-hop / connection-specific headers
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    # request smuggling / routing
    "host",
    "content-length",
    # cookies should not be set by user config for outbound provider calls
    "cookie",
    "set-cookie",
}

_MAX_ADDITIONAL_BODY_DEPTH = 8
_MAX_ADDITIONAL_BODY_KEYS = 200
_MAX_ADDITIONAL_BODY_LIST_ITEMS = 200
_MAX_ADDITIONAL_BODY_KEY_LEN = 128
_MAX_ADDITIONAL_BODY_STRING_LEN = 8192
_MAX_ADDITIONAL_BODY_BYTES = 65536

_DROP = object()


def _is_disallowed_ip(ip: ipaddress._BaseAddress) -> bool:  # type: ignore[name-defined]
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_host_ips(hostname: str, *, port: int) -> Iterable[ipaddress._BaseAddress]:  # type: ignore[name-defined]
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    seen: set[str] = set()
    for info in infos:
        ip_str = info[4][0]
        if ip_str in seen:
            continue
        seen.add(ip_str)
        try:
            yield ipaddress.ip_address(ip_str)
        except ValueError:
            continue


def validate_outbound_base_url(raw: str) -> str:
    """Validate and normalize a user-supplied base URL for outbound calls.

    Policy:
    - https only
    - no query/fragment/userinfo
    - disallow localhost / .local / private & reserved IP ranges (including via DNS)
    """
    value = (raw or "").strip()
    if not value:
        raise ValueError("base_url is required")

    parts = urlsplit(value)
    if parts.scheme != "https":
        raise ValueError("base_url must use https")
    if parts.query or parts.fragment:
        raise ValueError("base_url must not include query or fragment")
    if parts.username or parts.password:
        raise ValueError("base_url must not include userinfo")

    host = (parts.hostname or "").strip().lower()
    if not host:
        raise ValueError("base_url must include a hostname")
    if host in _DISALLOWED_HOSTS or any(host.endswith(s) for s in _DISALLOWED_HOST_SUFFIXES):
        raise ValueError("base_url hostname is not allowed")

    # Block direct IP literals that are not publicly routable.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and _is_disallowed_ip(ip):
        raise ValueError("base_url IP address is not allowed")

    # Resolve DNS and block private/reserved results (basic rebinding defense).
    if ip is None:
        port = parts.port or 443
        try:
            for resolved in _resolve_host_ips(host, port=port):
                if _is_disallowed_ip(resolved):
                    raise ValueError("base_url resolves to a private or disallowed IP")
        except socket.gaierror as e:
            raise ValueError(f"base_url hostname could not be resolved: {e}") from e

    # Normalize: keep scheme/netloc/path, strip trailing slashes from path.
    normalized_path = (parts.path or "").rstrip("/")
    return urlunsplit((parts.scheme, parts.netloc, normalized_path, "", ""))


def filter_additional_headers(headers: Optional[Dict[str, object]]) -> Dict[str, str]:
    """Sanitize user-supplied extra headers for outbound requests."""
    if not isinstance(headers, dict) or not headers:
        return {}

    out: Dict[str, str] = {}
    for k, v in headers.items():
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        name = k.strip()
        if not name:
            continue
        lower = name.lower()
        if lower in _DISALLOWED_HEADER_NAMES:
            continue
        value = v.strip()
        if not value:
            continue
        # Basic size limits to prevent abuse.
        if len(name) > 64 or len(value) > 1024:
            continue
        out[name] = value

        # Limit the number of custom headers.
        if len(out) >= 20:
            break

    return out


def _sanitize_additional_body_value(value: object, *, depth: int, state: Dict[str, int]) -> object:
    if depth > _MAX_ADDITIONAL_BODY_DEPTH:
        return _DROP

    if value is None:
        return None

    if isinstance(value, bool):
        return value

    if isinstance(value, int):
        return value

    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):  # NaN/Infinity
            return _DROP
        return value

    if isinstance(value, str):
        if len(value) > _MAX_ADDITIONAL_BODY_STRING_LEN:
            return _DROP
        return value

    if isinstance(value, list):
        out_list = []
        for item in value[:_MAX_ADDITIONAL_BODY_LIST_ITEMS]:
            cleaned = _sanitize_additional_body_value(item, depth=depth + 1, state=state)
            if cleaned is _DROP:
                continue
            out_list.append(cleaned)
        return out_list

    if isinstance(value, dict):
        out_dict: Dict[str, Any] = {}
        for k, v in value.items():
            if state["keys"] >= _MAX_ADDITIONAL_BODY_KEYS:
                break
            if not isinstance(k, str):
                continue
            key = k.strip()
            if not key or len(key) > _MAX_ADDITIONAL_BODY_KEY_LEN:
                continue
            cleaned = _sanitize_additional_body_value(v, depth=depth + 1, state=state)
            if cleaned is _DROP:
                continue
            out_dict[key] = cleaned
            state["keys"] += 1
        return out_dict

    return _DROP


def filter_additional_body(body: Optional[Dict[str, object]]) -> Dict[str, Any]:
    """Sanitize user-supplied JSON body extensions for outbound LLM requests."""
    if not isinstance(body, dict) or not body:
        return {}

    state = {"keys": 0}
    cleaned = _sanitize_additional_body_value(body, depth=0, state=state)
    if cleaned is _DROP or not isinstance(cleaned, dict):
        return {}

    try:
        encoded = json.dumps(cleaned, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    except Exception:
        return {}

    if len(encoded) > _MAX_ADDITIONAL_BODY_BYTES:
        return {}

    return cleaned


def merge_user_overrides(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two dictionaries with user override precedence."""
    merged: Dict[str, Any] = dict(base)
    for key, value in override.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            merged[key] = merge_user_overrides(existing, value)
        else:
            merged[key] = value
    return merged

