"""Skill 5 — draft the final email from content + authority."""
from __future__ import annotations

from typing import Any


def run(content: dict[str, Any], authority: dict[str, Any]) -> dict[str, Any]:
    """Compose to/subject/body ready for the user to review and send."""
    road = content.get("road") or content.get("display_name") or "the reported location"
    department = authority.get("department") or "Highways team"
    organization = authority.get("authority_name") or "Local council"

    subject = f"Road hazard report - {road}"

    facts_block = "\n".join(f"- {f}" for f in content.get("facts") or [])

    body = f"""Dear {department},

Layla detected a possible road hazard that may require inspection.

{content.get('headline', 'Hazard report')}

Location:
{content.get('location_summary') or road}

Key details:
{facts_block}

Description:
{content.get('description', '')}

Accessibility impact:
{content.get('accessibility_impact', '')}

Suggested action:
{content.get('suggested_action', 'Please inspect and arrange repairs.')}

This report has been generated for review before submission.

Regards,
Layla
"""

    return {
        "to": authority.get("email") or "",
        "subject": subject,
        "body": body.strip(),
        "recipient_name": department,
        "organization": organization,
    }
