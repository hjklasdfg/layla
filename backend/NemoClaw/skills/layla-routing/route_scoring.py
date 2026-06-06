"""Layla — scored, map-ready accessible routing (Approach A).

Runs a preference-weighted path search over the FUSED walkable graph (different
weights -> genuinely different geometry per persona), scores each route, and
emits objects the frontend Leaflet map can render directly.

Public seam:
    get_scored_routes(start, end, profile="general") -> {start, end, recommended_id, routes[]}

Each route is frontend-ready (MobilityRouteState-compatible):
    { id, start:{lat,lng}, end:{lat,lng}, etaMin, distanceM, variant,
      geometry:{coordinates:[[lat,lng],...]},      # Leaflet order
      score, signals:{accessibility,safety,comfort}, evidence[],
      mapFeatures:{crossings,steps,tactilePaving,riskPoints} }

Scoring reuses the frontend rules (services/osm/normalize.ts) — steps/tactile/
crossing penalties — extended with our fused layers (crime, noise, lighting).
"""
from __future__ import annotations
import os, sys, collections, pickle
_HERE = os.path.dirname(os.path.abspath(__file__))
# data tools + files live in the sibling layla-data skill
_DATA = os.environ.get("LAYLA_DATA_DIR") or os.path.normpath(os.path.join(_HERE, "..", "layla-data"))
sys.path.insert(0, _HERE)        # route_engine (this dir)
sys.path.insert(0, _DATA)        # layla_data_skill (data skill)
import route_engine as RE
import layla_data_skill as data

DIR = _HERE
_CACHE_FILE = os.path.join(DIR, "_graph_cache.pkl")

WALK = RE.WALK_SPEED_MPS

# weight sets (multipliers in RE._edge_cost) — per persona, including noise
ROUTE_PROFILES = {
    "general":      {"steps": 3, "crime": 1.0, "darkness": 0.5, "noise": 1.0},
    "blind":        {"steps": 6, "tactile": 1.0, "crime": 1.0, "darkness": 1.0, "noise": 2.0},
    "wheelchair":   {"steps": 50, "incline": 4, "crime": 1.0, "darkness": 0.3},
    "elderly":      {"steps": 8, "crime": 1.5, "darkness": 1.0, "noise": 1.5},
    "night_safety": {"steps": 3, "crime": 5.0, "darkness": 3.0},
}
# overall-score weights per profile: (accessibility, safety, comfort)
SCORE_W = {
    "general": (0.34, 0.33, 0.33), "blind": (0.50, 0.22, 0.28),
    "wheelchair": (0.60, 0.20, 0.20), "elderly": (0.40, 0.30, 0.30),
    "night_safety": (0.20, 0.55, 0.25),
}
# tiny City-of-London gazetteer for convenience (lat, lon)
PLACES = {
    "barbican": (51.5203, -0.0972), "moorgate": (51.5186, -0.0886),
    "bank": (51.5133, -0.0886), "st paul's": (51.5146, -0.0973),
    "st pauls": (51.5146, -0.0973), "liverpool street": (51.5178, -0.0823),
    "farringdon": (51.5203, -0.1053), "tower hill": (51.5099, -0.0766),
    "mansion house": (51.5122, -0.0940), "aldgate": (51.5143, -0.0755),
    "cannon street": (51.5113, -0.0904), "blackfriars": (51.5121, -0.1036),
    "monument": (51.5108, -0.0860), "fenchurch street": (51.5118, -0.0784),
    "holborn viaduct": (51.5170, -0.1040), "old street": (51.5256, -0.0877),
}

_CLAMP = lambda v: int(max(0, min(100, round(v))))

_NCELL = 0.003
_NOISE_GRID = None
def _noise_db(lat, lon):
    """Grid-indexed road-noise dB at a point (fast point-in-polygon)."""
    global _NOISE_GRID
    if _NOISE_GRID is None:
        grid = collections.defaultdict(list)
        for poly in data._noise():            # {ring, bbox(lon,lat), db, band}
            b = poly["bbox"]
            for gx in range(int(b[0] / _NCELL), int(b[2] / _NCELL) + 1):
                for gy in range(int(b[1] / _NCELL), int(b[3] / _NCELL) + 1):
                    grid[(gx, gy)].append(poly)
        _NOISE_GRID = grid
    for poly in _NOISE_GRID.get((int(lon / _NCELL), int(lat / _NCELL)), []):
        b = poly["bbox"]
        if b[0] <= lon <= b[2] and b[1] <= lat <= b[3] and data._point_in_ring(lon, lat, poly["ring"]):
            return poly["db"]
    return None

_GRAPH = None
def _graph():
    """Build once (enrich each edge with noise), cached in-memory + on disk.
    Disk cache auto-invalidates when the footway data is newer. Delete
    _graph_cache.pkl to force a rebuild."""
    global _GRAPH
    if _GRAPH is not None:
        return _GRAPH
    foot = os.path.join(_DATA, "layla_osm_footways.geojson")
    if os.path.exists(_CACHE_FILE) and os.path.getmtime(_CACHE_FILE) >= os.path.getmtime(foot):
        try:
            _GRAPH = pickle.load(open(_CACHE_FILE, "rb"))
            return _GRAPH
        except Exception:
            pass
    g = RE._build()
    nc = g["node_coord"]
    for (u, v), rec in g["cache"].items():
        mlat = (nc[u][1] + nc[v][1]) / 2.0
        mlon = (nc[u][0] + nc[v][0]) / 2.0
        nz = _noise_db(mlat, mlon)
        rec["noise"] = 0.0 if nz is None else max(0.0, min(1.0, (nz - 55.0) / 20.0))
    _GRAPH = g
    try:
        pickle.dump(g, open(_CACHE_FILE, "wb"))
    except Exception:
        pass
    return _GRAPH

def _resolve(loc):
    if isinstance(loc, (list, tuple)) and len(loc) == 2:
        return (float(loc[0]), float(loc[1]))
    if isinstance(loc, str):
        s = loc.strip()
        if "," in s:
            try:
                a, b = s.split(","); return (float(a), float(b))
            except ValueError:
                pass
        k = s.lower().replace("’", "'")
        if k in PLACES:
            return PLACES[k]
    raise ValueError(f"cannot resolve location: {loc!r}")

def _pt_near_path(lat, lon, path_nc, tol=28.0):
    return any(RE._haversine((lon, lat), c) <= tol for c in path_nc)

def _map_features(path_nc, step_pts):
    """Accessibility points near the route -> map layers for AccessibilityLayer."""
    lons = [c[0] for c in path_nc]; lats = [c[1] for c in path_nc]
    bbox = (min(lons) - 0.002, min(lats) - 0.0015, max(lons) + 0.002, max(lats) + 0.0015)
    crossings, tactile, risk = [], [], []
    for f in data.get_accessibility(bbox)["features"]:
        if not _pt_near_path(f["lat"], f["lon"], path_nc):
            continue
        cat = f.get("category")
        feat = {"type": cat, "lat": f["lat"], "lng": f["lon"]}
        if cat == "crossing":
            crossings.append({**feat, "reason": "Pedestrian crossing", "severity": "caution"})
        elif cat == "tactile_paving":
            tactile.append({**feat, "reason": "Tactile paving present", "severity": "support"})
        elif cat == "kerb":
            risk.append({**feat, "reason": "Kerb", "severity": "caution"})
    steps = [{"type": "steps", "lat": p[1], "lng": p[0],
              "reason": "Steps on path", "severity": "risk"} for p in step_pts]
    return {"crossings": crossings[:40], "steps": steps[:30],
            "tactilePaving": tactile[:30], "riskPoints": (steps + risk)[:40]}

def _build_route(g, path, profile, rid, variant, o, d):
    nc, cache = g["node_coord"], g["cache"]
    dist = steps = dark = incl = crime = 0.0
    noise_vals = []; step_pts = []
    for i in range(len(path) - 1):
        rec = cache[tuple(sorted((path[i], path[i + 1])))]
        dist += rec["L"]; steps += rec["steps"]; dark += rec["darkness"]
        incl += rec["incline"]; crime += rec["crime"]; noise_vals.append(rec["noise"])
        if rec["steps"]:
            c = nc[path[i]]; step_pts.append(c)
    n_edges = max(1, len(path) - 1)
    noise_avg = sum(noise_vals) / len(noise_vals) if noise_vals else 0.0
    crime_avg = crime / n_edges
    steps_seg = int(steps)

    path_nc = [nc[n] for n in path]                       # [lon,lat]
    mf = _map_features(path_nc, step_pts)
    crossings_n = len(mf["crossings"]); tactile_n = len(mf["tactilePaving"])

    accessibility = _CLAMP(100 - steps_seg * 20 - incl * 8 - max(0, crossings_n - tactile_n) * 4)
    safety = _CLAMP(2000.0 / (crime_avg + 20.0))          # saturating: denser crime -> lower, never floors
    comfort = _CLAMP(100 - noise_avg * 40 - dark * 4 - crossings_n * 1.5)
    wa, ws, wc = SCORE_W.get(profile, SCORE_W["general"])
    score = _CLAMP(accessibility * wa + safety * ws + comfort * wc)

    ev = []
    ev.append("Step-free route" if steps_seg == 0 else f"{steps_seg} step section(s)")
    if crime_avg < 1.5:
        ev.append("Avoids higher-crime stretches")
    if tactile_n:
        ev.append(f"{tactile_n} tactile-paving point(s)")
    if crossings_n:
        ev.append(f"{crossings_n} crossing(s)")
    if dark:
        ev.append(f"{int(dark)} unlit segment(s)")
    if noise_avg < 0.4:
        ev.append("Quieter streets")
    elif noise_avg > 0.7:
        ev.append("Passes noisy roads")

    geometry = [[c[1], c[0]] for c in path_nc]            # -> [lat,lng] for Leaflet
    return {
        "id": rid, "variant": variant,
        "start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]},
        "etaMin": max(1, round(dist / WALK / 60)),
        "distanceM": round(dist),
        "geometry": {"coordinates": geometry},
        "score": score,
        "signals": {"accessibility": accessibility, "safety": safety, "comfort": comfort},
        "evidence": ev,
        "mapFeatures": mf,
    }

def get_scored_routes(start, end, profile="general"):
    """Plan scored, map-ready routes. start/end = (lat,lon) | 'lat,lon' | place name."""
    g = _graph()
    o, d = _resolve(start), _resolve(end)
    nc = g["node_coord"]
    s = RE._nearest_node((o[1], o[0]), nc)
    t = RE._nearest_node((d[1], d[0]), nc)

    variants = [("personalized", ROUTE_PROFILES.get(profile, {})),
                ("fastest", {}),
                ("safest", ROUTE_PROFILES["night_safety"])]
    seen, picked = set(), []
    for label, w in variants:
        path = RE._dijkstra(g["adj"], s, t, w, g["cache"])
        if not path:
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key); picked.append((label, path))

    if not picked:
        return {"error": "no route found (graph disconnected between these points)",
                "start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]}, "routes": []}

    ids = "ABCD"
    routes = [_build_route(g, p, profile, ids[i], lbl, o, d) for i, (lbl, p) in enumerate(picked)]
    personalized = next((r for r in routes if r["variant"] == "personalized"), None)
    recommended = personalized["id"] if personalized else max(routes, key=lambda r: r["score"])["id"]
    return {"start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]},
            "profile": profile, "recommended_id": recommended, "routes": routes}


if __name__ == "__main__":
    import json
    OD = ("barbican", "st paul's")
    for prof in ["general", "blind", "wheelchair", "night_safety"]:
        r = get_scored_routes(*OD, prof)
        if "error" in r:
            print(f"[{prof}] {r['error']}"); continue
        rec = next(x for x in r["routes"] if x["id"] == r["recommended_id"])
        print(f"[{prof:12}] rec={r['recommended_id']} score={rec['score']} "
              f"{rec['distanceM']}m/{rec['etaMin']}min | "
              f"acc={rec['signals']['accessibility']} saf={rec['signals']['safety']} com={rec['signals']['comfort']} "
              f"| {len(rec['geometry']['coordinates'])} pts | variants={[x['id']+':'+str(x['distanceM'])+'m' for x in r['routes']]}")
