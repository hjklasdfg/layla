"""Run get_scored_routes for a few OD pairs x profiles -> routes_demo.js for the test map."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route_scoring as rs

ODS = {
    "Barbican → St Paul's": ("barbican", "st paul's"),
    "Barbican → Bank": ("barbican", "bank"),
    "Liverpool St → St Paul's": ("liverpool street", "st paul's"),
    "Farringdon → Bank": ("farringdon", "bank"),
}
PROFILES = ["general", "blind", "wheelchair", "elderly", "night_safety"]

out = {}
for name, (a, b) in ODS.items():
    out[name] = {}
    for p in PROFILES:
        r = rs.get_scored_routes(a, b, p)
        out[name][p] = r
        rec = next((x for x in r.get("routes", []) if x["id"] == r.get("recommended_id")), None)
        tag = f"{rec['distanceM']}m/score{rec['score']}" if rec else r.get("error", "?")
        print(f"  {name} [{p}] -> {tag}")

open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "routes_demo.js"), "w").write(
    "window.ROUTES=" + json.dumps(out, ensure_ascii=False) + ";\n")
print("wrote routes_demo.js")
