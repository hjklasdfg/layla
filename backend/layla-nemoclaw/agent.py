"""Layla hazard agent — orchestrates five independent skills."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

_ROOT = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.join(_ROOT, "skills")


def _load_skill(module_name: str, filename: str):
    path = os.path.join(_SKILLS, module_name, filename)
    spec = importlib.util.spec_from_file_location(f"skill_{module_name}", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


analyse_image = _load_skill("analyse-image", "analyse_image.py")
resolve_location = _load_skill("resolve-location", "resolve_location.py")
search_authority = _load_skill("search-authority", "search_authority.py")
prepare_content = _load_skill("prepare-content", "prepare_content.py")
prepare_email = _load_skill("prepare-email", "prepare_email.py")

StepCallback = Callable[[dict[str, Any]], None]
SkillCallback = Callable[[str, dict[str, Any]], None]

SKILL_IDS = (
    "analyse_image",
    "resolve_location",
    "search_authority",
    "prepare_content",
    "prepare_email",
)

STEP_META = {
    "analyse_image": ("Analyse image (VLM)", analyse_image.MODEL_ID),
    "resolve_location": ("Resolve location (Nominatim)", "OpenStreetMap"),
    "search_authority": ("Search authority (web)", "DuckDuckGo"),
    "prepare_content": ("Prepare report content", "structured facts"),
    "prepare_email": ("Prepare email draft", "to / subject / body"),
    "ready": ("Ready — review before send", ""),
}


@dataclass
class AgentStep:
    id: str
    label: str
    status: str = "pending"
    thought: str | None = None
    detail: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "status": self.status,
            "thought": self.thought,
            "detail": self.detail,
        }


@dataclass
class HazardAgentResult:
    status: str
    skills: dict[str, Any] = field(default_factory=dict)
    user_profile: str = "general"
    message: str | None = None
    ui_actions: list[str] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status,
            "skills": self.skills,
            "user_profile": self.user_profile,
            "steps": self.steps,
        }
        if self.message:
            out["message"] = self.message
        if self.ui_actions:
            out["ui_actions"] = self.ui_actions
        return out


class HazardAgent:
    """Chains five skills; emits step + skill output callbacks."""

    def __init__(
        self,
        on_step: StepCallback | None = None,
        on_skill: SkillCallback | None = None,
    ):
        self._on_step = on_step
        self._on_skill = on_skill
        self._steps: list[AgentStep] = [
            AgentStep(id=sid, label=STEP_META[sid][0])
            for sid in (*SKILL_IDS, "ready")
        ]
        self._skills: dict[str, Any] = {}

    def _emit_step(self, step: AgentStep) -> None:
        if self._on_step:
            self._on_step(step.to_dict())

    def _emit_skill(self, skill_id: str, output: dict[str, Any]) -> None:
        self._skills[skill_id] = output
        if self._on_skill:
            self._on_skill(skill_id, output)

    def _update(self, step_id: str, **patch: Any) -> AgentStep:
        step = next(s for s in self._steps if s.id == step_id)
        for key, value in patch.items():
            setattr(step, key, value)
        self._emit_step(step)
        return step

    def run(
        self,
        image_path: str,
        lat: float,
        lng: float,
        user_profile: str = "general",
    ) -> HazardAgentResult:
        # Skill 1
        label, provider = STEP_META["analyse_image"]
        self._update(
            "analyse_image",
            status="running",
            thought=f"Running {label} via {provider}…",
        )
        hazard = analyse_image.run(image_path)
        self._emit_skill("analyse_image", hazard)
        self._update(
            "analyse_image",
            status="done",
            thought=f"{hazard.get('hazard_type', 'none')} · {hazard.get('severity', 'n/a')}",
            detail=hazard.get("description"),
        )

        # Skill 2
        self._update(
            "resolve_location",
            status="running",
            thought=f"Reverse geocoding {lat:.5f}, {lng:.5f}…",
        )
        location = resolve_location.run(lat, lng)
        self._emit_skill("resolve_location", location)
        borough = location.get("borough") or "Unknown"
        road = location.get("road") or ""
        self._update(
            "resolve_location",
            status="done",
            thought=f"{borough}" + (f", {road}" if road else ""),
            detail=location.get("display_name"),
        )

        if not hazard.get("hazard_detected"):
            for sid in ("search_authority", "prepare_content", "prepare_email"):
                self._update(sid, status="done", thought="Skipped — no hazard detected.")
            self._update("ready", status="done", thought="No report needed.")
            return HazardAgentResult(
                status="no_hazard_detected",
                skills=self._skills,
                message="No clear road hazard was detected.",
                user_profile=user_profile,
                steps=[s.to_dict() for s in self._steps],
            )

        # Skill 3
        self._update(
            "search_authority",
            status="running",
            thought=f"Searching for {borough} contact for {hazard.get('hazard_type')}…",
        )
        authority = search_authority.run(location, hazard["hazard_type"])
        self._emit_skill("search_authority", authority)
        n = len(authority.get("search_results") or [])
        self._update(
            "search_authority",
            status="done",
            thought=f"{authority.get('authority_name')} ({authority.get('source')})",
            detail=f"{n} web results" if n else authority.get("query"),
        )

        # Skill 4
        self._update("prepare_content", status="running", thought="Assembling report facts…")
        content = prepare_content.run(hazard, location, user_profile)
        self._emit_skill("prepare_content", content)
        self._update(
            "prepare_content",
            status="done",
            thought=content.get("headline"),
            detail=content.get("location_summary"),
        )

        # Skill 5
        self._update("prepare_email", status="running", thought="Drafting email…")
        email = prepare_email.run(content, authority)
        self._emit_skill("prepare_email", email)
        self._update(
            "prepare_email",
            status="done",
            thought=f"To: {email.get('to')}",
            detail=email.get("subject"),
        )

        self._update("ready", status="done", thought="Review each skill output and send when ready.")

        return HazardAgentResult(
            status="report_preview_ready",
            skills=self._skills,
            user_profile=user_profile,
            ui_actions=["copy_report", "edit_report", "find_safer_route"],
            steps=[s.to_dict() for s in self._steps],
        )


def run_agent(
    image_path: str,
    lat: float,
    lng: float,
    user_profile: str = "general",
    on_step: StepCallback | None = None,
    on_skill: SkillCallback | None = None,
) -> dict[str, Any]:
    return HazardAgent(on_step=on_step, on_skill=on_skill).run(
        image_path, lat, lng, user_profile=user_profile
    ).to_dict()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Layla hazard agent (5 skills)")
    parser.add_argument("--image", required=True)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lng", type=float, required=True)
    parser.add_argument("--user-profile", default="general")
    parser.add_argument("--verbose-steps", action="store_true")
    args = parser.parse_args()

    def _print_step(step: dict[str, Any]) -> None:
        if args.verbose_steps:
            print(f"[{step['id']}] {step['status']}: {step.get('thought')}", flush=True)

    def _print_skill(skill_id: str, output: dict[str, Any]) -> None:
        if args.verbose_steps:
            print(f"<skill {skill_id}>", flush=True)

    result = run_agent(
        args.image,
        args.lat,
        args.lng,
        user_profile=args.user_profile,
        on_step=_print_step if args.verbose_steps else None,
        on_skill=_print_skill if args.verbose_steps else None,
    )
    print(json.dumps(result, indent=2))
