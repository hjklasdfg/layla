"""Layla — /mobility/plan backend (the agent's delivery channel).

The frontend (when BACKEND_API_URL is set) POSTs a BackendMobilityPlanRequest
here and renders whatever MobilityRouteState[] we return. This server plays the
AGENT step: take the user's journey + profile, call the route-scoring skill, and
push back the final, map-ready route — exactly the payload a real NemoClaw agent
would deliver. Swap `plan()`'s inner call for NemoClaw later; the contract holds.

Run:  python mobility_plan_server.py         # :8000  (PORT=... to override)
Then: frontend/.env.local -> BACKEND_API_URL=http://localhost:8000
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route_scoring as rs

PORT = int(os.getenv("PORT", "8000"))
_clamp = lambda v: int(max(0, min(100, round(v))))
VARIANT_NAME = {"personalized": "Personalized route", "fastest": "Fastest route", "safest": "Safest route"}
PROFILE_LABEL = {"general": "General", "blind": "Blind / low-vision", "wheelchair": "Wheelchair",
                 "elderly": "Elderly", "night_safety": "Night safety"}
PRIORITY_LABEL = {"most_accessible": "Personalized", "fastest": "Fastest",
                  "most_reliable": "Most reliable", "least_stressful": "Least stressful"}


def _signals(r):
    # our 5 signals {accessibility,safety,quiet,lighting,air} -> frontend's 6 AccessibilitySignals
    # slots (interim, until RouteCard shows our 5 directly). Surfaces crime + noise + lighting.
    s = r["signals"]
    cross_n = len(r["mapFeatures"]["crossings"])
    return {
        "accessibility": s["accessibility"],
        "stress": _clamp(100 - s["quiet"]),        # noisy -> stressful
        "reliability": s["safety"],                 # crime-safety
        "predictability": s["lighting"],            # lit -> see what's ahead
        "crowding": _clamp(100 - s["quiet"]),       # proxy (no crowd data)
        "crossingComplexity": _clamp(cross_n * 8),
    }

def _state(r):
    ev = r.get("evidence", [])
    mf = r["mapFeatures"]
    risks = [e for e in ev if any(k in e.lower() for k in ("step", "noisy", "unlit"))]
    strengths = [e for e in ev if e not in risks]
    return {
        "id": r["id"], "name": VARIANT_NAME.get(r["variant"], r["variant"]),
        "etaMin": r["etaMin"], "geometry": r["geometry"],
        "start": r["start"], "end": r["end"],
        "signals": _signals(r),
        "signals5": r["signals"],                  # our clean 5 signals (for the updated RouteCard)
        "evidence": {"tfl": [], "osm": ev, "cv": []},
        "risks": risks, "strengths": strengths,
        "steps": [], "transferCount": 0, "walkingMinutes": r["etaMin"],
        "disruptions": [], "modes": ["walking"],
        "riskyFeatures": mf["riskPoints"],
        "osmContext": {                              # frontend AccessibilityLayer reads this
            "crossingCount": len(mf["crossings"]), "trafficSignalCount": 0,
            "footwayCount": 0, "stepsCount": len(mf["steps"]), "kerbCount": 0,
            "tactilePavingCount": len(mf["tactilePaving"]), "wheelchairTaggedCount": 0,
            "riskyFeatures": mf["riskPoints"], "evidence": ev, "mapFeatures": mf,
        },
    }

def _enriched(st):
    return {"routeId": st["id"], "name": st["name"], "etaMin": st["etaMin"],
            "signals": st["signals"], "signals5": st.get("signals5"),
            "evidence": st["evidence"],
            "risks": st["risks"], "strengths": st["strengths"],
            "transferCount": 0, "walkingMinutes": st["walkingMinutes"]}


def plan(journey, preference):
    """AGENT STEP — profile → skill → final route. Replace inner call with NemoClaw later."""
    start = (journey or {}).get("start"); dest = (journey or {}).get("destination")
    profile = (preference or {}).get("profile", "general")
    if profile == "custom":
        profile = "general"
    priority = (preference or {}).get("priority", "most_accessible")
    r = rs.get_scored_routes(start, dest, profile, priority)
    if r.get("error"):
        return None, r["error"]

    states = [_state(x) for x in r["routes"]]
    rec_id = r["recommended_id"]
    rec = next(x for x in r["routes"] if x["id"] == rec_id)
    ev = ", ".join(rec.get("evidence", [])[:3]).lower()
    label = PROFILE_LABEL.get(profile, profile)
    recommendation = {
        "provider": "backend",
        "recommendedRouteId": rec_id,
        "routeComparison": f"{len(states)} routes compared for a {label} profile ({start} → {dest}).",
        "tradeoffExplanation": f"Route {rec_id} — {rec['distanceM']} m, ~{rec['etaMin']} min on foot; {ev}.",
        "finalRecommendation": f"I'd take route {rec_id}: {ev}. About {rec['etaMin']} minutes walking.",
    }
    explanation = {
        "uiText": f"**Why Route {rec_id}?** {recommendation['tradeoffExplanation']}\n\n"
                  f"_Personalised for a **{label}** profile._",
        "voiceText": recommendation["finalRecommendation"],
    }
    return {
        "journey": {"start": start, "destination": dest},
        "routes": states,
        "enrichedRoutes": [_enriched(s) for s in states],
        "recommendation": recommendation,
        "explanation": explanation,
        "meta": {"source": "backend", "from": start, "to": dest,
                 "count": len(states), "profile": profile},
    }, None


def compare(journey, combos):
    """Overlay mode: one route per (profile, priority) combo for the same OD."""
    start = (journey or {}).get("start"); dest = (journey or {}).get("destination")
    if not combos:
        return None, "No profile/preference combinations selected."
    r = rs.get_combo_comparison(start, dest, combos)
    if r.get("error"):
        return None, r["error"]
    states = []
    for rt in r["routes"]:
        st = _state(rt)
        st["id"] = rt["id"]
        st["name"] = (f"{PROFILE_LABEL.get(rt['profile'], rt['profile'])} · "
                      f"{PRIORITY_LABEL.get(rt['priority'], rt['priority'])}")
        st["profile"] = rt["profile"]; st["priority"] = rt["priority"]
        states.append(st)
    if not states:
        return None, "No routes found for those combinations."
    return {
        "journey": {"start": start, "destination": dest},
        "routes": states,
        "enrichedRoutes": [_enriched(s) for s in states],
        "recommendation": {
            "provider": "backend", "recommendedRouteId": states[0]["id"],
            "routeComparison": f"{len(states)} routes overlaid for {start} → {dest}.",
            "tradeoffExplanation": "Each coloured line is one profile + preference combination.",
            "finalRecommendation": "Compare how the route changes by profile and preference.",
        },
        "explanation": {
            "uiText": "**Comparison** — each line is one profile + preference combination.",
            "voiceText": "Here are the routes for each selected combination.",
        },
        "meta": {"source": "backend", "from": start, "to": dest, "count": len(states), "profile": "compare"},
    }, None


def lookup(body):
    """Ask-Layla data lookup: what's around a place + (optionally) live line status.
    The frontend's /api/ask supplies {place, transit}; Nemotron turns this into prose."""
    place = (body or {}).get("place") or ""
    out = {"place": place}
    if (body or {}).get("transit"):
        try:
            out["transit"] = rs.data.get_line_status()
        except Exception as e:                       # noqa: BLE001
            out["transit"] = {"error": str(e)[:80]}
    if place:
        try:
            lat, lon = rs._resolve(place)
            out["lat"], out["lon"] = lat, lon
            out["context"] = rs.data.get_context(lat, lon, 250)
        except Exception:                            # noqa: BLE001
            out["place_error"] = f"couldn't locate '{place}'"
    return out, None


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send(200, {"ok": True, "service": "mobility-plan", "places": list(rs.PLACES)})
        self._send(404, {"error": "POST /mobility/plan"})

    def do_POST(self):
        is_compare = self.path.startswith("/mobility/compare")
        is_lookup = self.path.startswith("/lookup")
        if not (is_compare or is_lookup or self.path.startswith("/mobility/plan")):
            return self._send(404, {"error": "POST /mobility/plan | /mobility/compare | /lookup"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError) as e:
            return self._send(400, {"error": f"bad JSON: {e}"})
        try:
            if is_lookup:
                resp, err = lookup(req)
            elif is_compare:
                resp, err = compare(req.get("journey"), req.get("combos"))
            else:
                resp, err = plan(req.get("journey"), req.get("preference"))
        except Exception as e:                       # never crash the handler -> never "fetch failed"
            return self._send(500, {"error": f"routing failed: {e}"})
        if err:
            return self._send(422, {"error": err})
        self._send(200, resp)

    def log_message(self, *a):  # quieter
        sys.stderr.write("  " + (a[0] % a[1:]) + "\n")


if __name__ == "__main__":
    print(f"Layla /mobility/plan agent-channel on http://localhost:{PORT}")
    print(f"  POST /mobility/plan  ·  GET /health  ·  places: {', '.join(rs.PLACES)}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
