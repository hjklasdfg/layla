"""Skill 3 — web search for the council/authority (DuckDuckGo, no API key)."""
from __future__ import annotations

import re
from html import unescape
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import requests

USER_AGENT = "LaylaHackathonDemo/1.0 (hazard report)"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
DDG_HTML = "https://html.duckduckgo.com/html/"


def _normalize_results(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in raw:
        title = (r.get("title") or "").strip()
        url = (r.get("url") or r.get("href") or "").strip()
        desc = (r.get("description") or r.get("body") or "").strip()
        if title or url:
            out.append({"title": title, "url": url, "description": desc})
    return out


def _unwrap_ddg_url(href: str) -> str:
    if "uddg=" in href:
        parsed = parse_qs(urlparse(href).query)
        uddg = parsed.get("uddg", [""])[0]
        if uddg:
            return unquote(uddg)
    return href


def _search_duckduckgo_html(query: str, max_results: int) -> list[dict[str, Any]]:
    res = requests.post(
        DDG_HTML,
        data={"q": query},
        headers={"User-Agent": USER_AGENT},
        timeout=12,
    )
    res.raise_for_status()
    html = res.text

    blocks = re.split(r'<div class="result\s', html)[1:]
    results: list[dict[str, Any]] = []

    for block in blocks:
        title_m = re.search(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            block,
            re.DOTALL,
        )
        snippet_m = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not title_m:
            continue

        title = unescape(re.sub(r"<[^>]+>", "", title_m.group(2))).strip()
        url = _unwrap_ddg_url(unescape(title_m.group(1)))
        desc = ""
        if snippet_m:
            desc = unescape(re.sub(r"<[^>]+>", "", snippet_m.group(1))).strip()

        results.append({"title": title, "url": url, "description": desc})
        if len(results) >= max_results:
            break

    return results


def _search_duckduckgo_package(query: str, max_results: int) -> list[dict[str, Any]]:
    from duckduckgo_search import DDGS

    with DDGS() as ddgs:
        hits = list(ddgs.text(query, max_results=max_results))
    return _normalize_results(hits)


def _web_search(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    try:
        results = _search_duckduckgo_html(query, max_results)
        if results:
            return results
    except Exception:
        pass

    try:
        return _search_duckduckgo_package(query, max_results)
    except Exception:
        return []


def _pick_email(results: list[dict[str, Any]], borough: str) -> str:
    candidates: list[str] = []
    for r in results:
        blob = " ".join(
            x for x in (r.get("title"), r.get("description"), r.get("url")) if x
        )
        for email in EMAIL_RE.findall(blob):
            low = email.lower()
            if any(
                token in low
                for token in (".gov.uk", "tfl.gov.uk", "highways", "streetcare", "parking")
            ):
                candidates.append(email)

    if candidates:
        return candidates[0]

    return "demo-streetcare@example.gov.uk"


def run(location: dict[str, Any], hazard_type: str) -> dict[str, Any]:
    """Search the web for the reporting authority email or contact page."""
    borough = location.get("borough") or "Unknown"
    query = f"{borough} council report {hazard_type} road hazard email"

    search_results = _web_search(query, max_results=5)
    source = "duckduckgo" if search_results else "duckduckgo_empty"

    return {
        "authority_name": f"{borough} Council",
        "department": "Highways / Street Care",
        "email": _pick_email(search_results, borough),
        "source": source,
        "query": query,
        "search_results": search_results,
    }
