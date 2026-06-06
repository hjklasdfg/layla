"""Tests for the layla-routing skill (scored accessible route planning).

Reads data from the sibling layla-data skill. Run:
  python test_route_scoring.py        # standalone
  pytest test_route_scoring.py -v
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route_scoring as rs


def test_scored_routes_are_map_ready():
    r = rs.get_scored_routes("barbican", "aldgate", "wheelchair")
    assert r.get("routes"), "expected at least one route"
    rt = next(x for x in r["routes"] if x["id"] == r["recommended_id"])
    coords = rt["geometry"]["coordinates"]
    assert coords and len(coords[0]) == 2
    lat, lng = coords[0]                              # Leaflet order [lat, lng]
    assert 51 < lat < 52 and -0.2 < lng < 0.1
    for k in ("score", "signals", "etaMin", "distanceM", "evidence", "mapFeatures"):
        assert k in rt
    for s in ("accessibility", "safety", "quiet", "lighting", "air"):
        assert 0 <= rt["signals"][s] <= 100

def test_recommended_fits_profile():
    # recommended = highest persona-weighted score in the length pool; for wheelchair
    # that should be a highly accessible (step-free) route.
    r = rs.get_scored_routes("barbican", "st pauls", "wheelchair")
    rec = next(x for x in r["routes"] if x["id"] == r["recommended_id"])
    assert rec["signals"]["accessibility"] >= 80, "wheelchair route should be highly accessible"

def test_strict_breaks_length_cap():
    # strict can surface a longer fully-accessible route the default cap would exclude
    base = rs.get_scored_routes("barbican", "st pauls", "blind")
    strict = rs.get_scored_routes("barbican", "st pauls", "blind", strict=True)
    base_rec = next(x for x in base["routes"] if x["id"] == base["recommended_id"])
    strict_rec = next(x for x in strict["routes"] if x["id"] == strict["recommended_id"])
    assert strict_rec["signals"]["accessibility"] >= base_rec["signals"]["accessibility"]

def test_routes_differ_by_profile():
    a = rs.get_scored_routes("farringdon", "aldgate", "wheelchair")
    b = rs.get_scored_routes("farringdon", "aldgate", "night_safety")
    ga = next(x for x in a["routes"] if x["id"] == a["recommended_id"])["geometry"]["coordinates"]
    gb = next(x for x in b["routes"] if x["id"] == b["recommended_id"])["geometry"]["coordinates"]
    assert ga != gb, "wheelchair and night-safety routes should differ in geometry"

def test_full_borough_reachable():
    # cross-borough OD that the old corridor graph could not route
    r = rs.get_scored_routes("farringdon", "aldgate", "general")
    assert not r.get("error") and r["routes"], "full-borough route should exist"


if __name__ == "__main__":
    tests = sorted(n for n in dir() if n.startswith("test_"))
    p = f = 0
    for n in tests:
        try:
            globals()[n](); print("  PASS", n); p += 1
        except Exception as e:
            print("  FAIL", n, type(e).__name__, e); f += 1
    print(f"{p} passed, {f} failed")
    sys.exit(1 if f else 0)
