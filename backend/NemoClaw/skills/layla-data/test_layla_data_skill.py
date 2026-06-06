"""Test suite for the layla-data NemoClaw skill.

Covers all 10 tools. Static layers assert against real bundled data; live TfL
tools assert structure and accept live-OR-cached (so it passes without a key).

Run:
  python test_layla_data_skill.py          # standalone (plain asserts)
  pytest test_layla_data_skill.py -v       # with pytest
  TFL_APP_KEY=... python test_layla_data_skill.py   # also exercises live TfL
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layla_data_skill as data

CORRIDOR = (-0.100, 51.515, -0.090, 51.522)   # (w, s, e, n)
BARBICAN = (51.5203, -0.0972)                  # (lat, lon)
BARBICAN_NAPTAN = "940GZZLUBBN"


# ---------- static layers (no key needed) ----------
def test_accessibility_returns_features_in_corridor():
    r = data.get_accessibility(CORRIDOR)
    assert r["count"] > 0, "expected accessibility points in the corridor"
    assert {"lat", "lon", "category"} <= set(r["features"][0])

def test_accessibility_bbox_is_respected():
    for f in data.get_accessibility(CORRIDOR)["features"]:
        assert CORRIDOR[0] <= f["lon"] <= CORRIDOR[2]
        assert CORRIDOR[1] <= f["lat"] <= CORRIDOR[3]

def test_crime_returns_points_and_breakdown():
    r = data.get_crime(CORRIDOR)
    assert r["count"] > 0
    assert isinstance(r["by_type"], dict) and r["by_type"]
    assert sum(r["by_type"].values()) == r["count"]
    assert {"lat", "lon", "type"} <= set(r["points"][0])

def test_crime_smaller_bbox_has_fewer_points():
    small = (-0.098, 51.518, -0.096, 51.520)
    assert data.get_crime(small)["count"] <= data.get_crime(CORRIDOR)["count"]

def test_noise_at_barbican_has_band():
    r = data.get_noise(*BARBICAN)
    assert r["band"] is not None, "Barbican should fall in a noise polygon"
    assert isinstance(r["noise_db"], (int, float))

def test_air_returns_index_field():
    r = data.get_air(*BARBICAN)
    assert "air_index" in r

def test_walkable_graph_has_fused_edges():
    g = data.get_walkable_graph(CORRIDOR)
    assert g["node_count"] > 0 and g["edge_count"] > 0
    e = g["edges"][0]
    for k in ("from", "to", "length_m", "highway", "lit",
              "is_steps", "crime_count", "noise_db", "air_index"):
        assert k in e, f"edge missing fused attribute: {k}"
    assert isinstance(e["crime_count"], int)
    assert isinstance(e["length_m"], (int, float)) and e["length_m"] >= 0

def test_context_aggregates_all_local_layers():
    c = data.get_context(*BARBICAN)
    for k in ("accessibility_nearby", "crime_count_nearby", "noise", "air"):
        assert k in c
    assert isinstance(c["crime_count_nearby"], int)


# ---------- live TfL (pass with or without key: live OR cached/unavailable) ----------
def test_live_disruptions_structure():
    r = data.get_live_disruptions()
    assert r["source"] in ("live", "cached")
    assert isinstance(r.get("disruptions"), list)

def test_crowding_structure():
    r = data.get_crowding(BARBICAN_NAPTAN)
    assert r["source"] in ("live", "cached")
    assert "percentage_of_baseline" in r

def test_line_status_structure():
    r = data.get_line_status()
    assert r["source"] in ("live", "unavailable")
    if r["source"] == "live":
        assert r["count"] > 0
        assert {"line", "mode", "status"} <= set(r["lines"][0])

def test_road_disruptions_structure_and_bbox():
    r = data.get_road_disruptions()
    assert r["source"] in ("live", "unavailable")
    if r["source"] == "live":
        city = (-0.115, 51.508, -0.078, 51.530)
        assert data.get_road_disruptions(city)["count"] <= r["count"]


# ---------- standalone runner (no pytest needed) ----------
if __name__ == "__main__":
    tests = sorted(n for n in dir() if n.startswith("test_"))
    has_key = bool(os.getenv("TFL_APP_KEY"))
    print(f"Running {len(tests)} tests  (TFL_APP_KEY={'set → live' if has_key else 'unset → cached/graceful'})\n")
    passed = failed = 0
    for name in tests:
        try:
            globals()[name]()
            print(f"  PASS  {name}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {name}: {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
