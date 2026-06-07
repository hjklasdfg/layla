"""Tests for layla-nemoclaw agent and skills."""
from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

os.environ["LAYLA_NEMOCLAW_DEMO"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agent  # noqa: E402


class TestHazardSkills(unittest.TestCase):
    def test_analyse_image_demo(self):
        out = agent.analyse_image.run("/tmp/x.jpg")
        self.assertTrue(out["hazard_detected"])
        self.assertIn("hazard_type", out)

    @patch("requests.get")
    def test_resolve_location(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "display_name": "Fleet Street",
                "address": {"road": "Fleet Street", "city_district": "City of London"},
            },
        )
        loc = agent.resolve_location.run(51.5136, -0.1109)
        self.assertEqual(loc["borough"], "City of London")

    @patch.object(agent.search_authority, "_web_search")
    def test_search_authority_duckduckgo(self, mock_search):
        mock_search.return_value = [
            {
                "title": "Report a pothole",
                "url": "https://www.camden.gov.uk/report",
                "description": "Email highways@camden.gov.uk for street defects.",
            }
        ]
        auth = agent.search_authority.run({"borough": "Camden"}, "pothole")
        self.assertEqual(auth["source"], "duckduckgo")
        self.assertEqual(auth["email"], "highways@camden.gov.uk")
        self.assertEqual(len(auth["search_results"]), 1)

    def test_prepare_content(self):
        content = agent.prepare_content.run(
            {"hazard_type": "pothole", "severity": "high", "confidence": 0.9,
             "description": "Big hole", "accessibility_impact": "Wheelchair risk"},
            {"road": "Fleet St", "borough": "City of London", "lat": 51.51, "lng": -0.11},
        )
        self.assertIn("pothole", content["headline"])
        self.assertGreater(len(content["facts"]), 2)

    def test_prepare_email(self):
        email = agent.prepare_email.run(
            {"headline": "Pothole", "facts": ["Severity: high"], "description": "Deep",
             "accessibility_impact": "Risk", "road": "Fleet St", "location_summary": "Fleet St",
             "suggested_action": "Inspect"},
            {"email": "a@b.gov", "department": "Highways", "authority_name": "Council"},
        )
        self.assertEqual(email["to"], "a@b.gov")
        self.assertIn("Pothole", email["body"])

    @patch.object(agent.search_authority, "_web_search")
    @patch("requests.get")
    def test_agent_five_skills(self, mock_get, mock_ddg):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"display_name": "London", "address": {"borough": "Westminster"}},
        )
        mock_ddg.return_value = [
            {"title": "Westminster highways", "url": "https://gov.uk", "description": "streets@westminster.gov.uk"}
        ]
        skills_seen = []
        result = agent.run_agent(
            "/tmp/x.jpg", 51.5, -0.12,
            on_skill=lambda sid, _: skills_seen.append(sid),
        )
        self.assertEqual(result["status"], "report_preview_ready")
        self.assertEqual(
            set(result["skills"].keys()),
            {"analyse_image", "resolve_location", "search_authority", "prepare_content", "prepare_email"},
        )
        self.assertEqual(skills_seen, list(agent.SKILL_IDS))


if __name__ == "__main__":
    unittest.main()
