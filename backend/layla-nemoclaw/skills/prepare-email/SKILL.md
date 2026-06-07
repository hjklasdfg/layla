---
name: prepare-email
description: >
  Draft the final report email (to, subject, body) from prepared content and the
  authority contact found by web search. Use as skill 5 — last step before UI
  review.
---

# Skill 5 — Prepare Email

| Tool | Input | Returns |
|---|---|---|
| `run(content, authority)` | outputs from skills 3 + 4 | `{to, subject, body, recipient_name, organization}` |

```bash
echo '{"content":{"headline":"Pothole","facts":["Severity: high"],"description":"..."},"authority":{"email":"streets@example.gov.uk","department":"Highways","authority_name":"Example Council"}}' | python3 scripts/query.py prepare_email
```
