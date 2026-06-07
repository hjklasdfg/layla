"""Skill 4 — assemble structured report content from hazard + location."""
from __future__ import annotations

from typing import Any


def run(
    hazard: dict[str, Any],
    location: dict[str, Any],
    user_profile: str = "general",
) -> dict[str, Any]:
    """Build the factual report body content (not the email envelope yet)."""
    road = location.get("road") or location.get("display_name") or "the reported location"
    borough = location.get("borough") or "Unknown"
    hazard_type = hazard.get("hazard_type") or "unknown"
    severity = hazard.get("severity") or "low"

    location_summary = ", ".join(
        p
        for p in [
            road if road != location.get("display_name") else None,
            borough,
            location.get("postcode"),
        ]
        if p
    )

    facts = [
        f"Hazard type: {hazard_type}",
        f"Severity: {severity}",
        f"Confidence: {hazard.get('confidence', 'n/a')}",
        f"Street: {road}",
        f"Borough: {borough}",
        f"GPS: {location.get('lat')}, {location.get('lng')}",
    ]
    if location.get("postcode"):
        facts.append(f"Postcode: {location['postcode']}")

    return {
        "headline": f"{hazard_type} — {severity} severity",
        "hazard_type": hazard_type,
        "severity": severity,
        "description": hazard.get("description") or "",
        "accessibility_impact": hazard.get("accessibility_impact") or "",
        "confidence": hazard.get("confidence"),
        "location_summary": location_summary or location.get("display_name"),
        "display_name": location.get("display_name"),
        "road": location.get("road"),
        "borough": borough,
        "postcode": location.get("postcode"),
        "gps": {"lat": location.get("lat"), "lng": location.get("lng")},
        "facts": facts,
        "user_profile": user_profile,
        "suggested_action": "Request council inspection and temporary mitigation if needed.",
    }
