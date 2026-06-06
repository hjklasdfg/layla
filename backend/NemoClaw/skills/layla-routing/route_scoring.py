"""Layla — scored, map-ready accessible routing (Approach A).

Runs a preference-weighted path search over the FUSED walkable graph (different
weights -> genuinely different geometry per persona), scores each route, and
emits objects the frontend Leaflet map can render directly.

Public seam:
    get_scored_routes(start, end, profile="general") -> {start, end, recommended_id, routes[]}

Each route is frontend-ready (MobilityRouteState-compatible):
    { id, start:{lat,lng}, end:{lat,lng}, etaMin, distanceM, variant,
      geometry:{coordinates:[[lat,lng],...]},      # Leaflet order
      score, signals:{accessibility,safety,quiet,lighting,air}, evidence[],
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

# Routing weights (multipliers in RE._edge_cost) — shape the GEOMETRY per persona.
# Amplified so routes visibly diverge between personas.
ROUTE_PROFILES = {
    "general":      {"steps": 3,  "crime": 1.0, "darkness": 0.5, "noise": 1.0},
    "blind":        {"steps": 8,  "tactile": 2.0, "crime": 1.5, "darkness": 1.5, "noise": 3.0},
    "wheelchair":   {"steps": 80, "incline": 6, "crime": 1.0, "darkness": 0.5, "noise": 0.3},
    "elderly":      {"steps": 12, "crime": 2.0, "darkness": 1.5, "noise": 2.0},
    "night_safety": {"steps": 3,  "crime": 8.0, "darkness": 5.0},
}
# Scoring weights over the 5 signals — pick the RECOMMENDED route. Amplified main signal.
SIGNAL_KEYS = ("accessibility", "safety", "quiet", "lighting", "air")
SCORE_W = {
    "general":      {"accessibility": .25, "safety": .25, "quiet": .22, "lighting": .16, "air": .12},
    "blind":        {"accessibility": .60, "safety": .15, "quiet": .15, "lighting": .07, "air": .03},
    "wheelchair":   {"accessibility": .70, "safety": .12, "quiet": .06, "lighting": .08, "air": .04},
    "elderly":      {"accessibility": .40, "safety": .25, "quiet": .15, "lighting": .18, "air": .02},
    "night_safety": {"accessibility": .08, "safety": .50, "quiet": .05, "lighting": .35, "air": .02},
}
LENGTH_CAP = 1.5   # exclude routes >50% longer than the fastest (unless strict)
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

def _geocode(q):
    """Best-effort Nominatim geocode, biased to central London. stdlib only."""
    import urllib.request, urllib.parse, json as _json
    params = urllib.parse.urlencode({
        "q": f"{q}, London, UK", "format": "json", "limit": 1,
        "viewbox": "-0.125,51.506,-0.070,51.526", "bounded": 0,
    })
    req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + params,
                                 headers={"User-Agent": "Layla/0.1 (accessibility mobility hackathon)"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            hits = _json.load(r)
        if hits:
            return (float(hits[0]["lat"]), float(hits[0]["lon"]))
    except Exception:
        pass
    return None

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
        geo = _geocode(s)                 # fall back to geocoding unknown place names
        if geo:
            return geo
    raise ValueError(f"cannot resolve location: {loc!r}")

_BBOX = None
def _coverage_bbox(g):
    """(w, s, e, n) of the routable graph — to reject out-of-coverage requests cleanly."""
    global _BBOX
    if _BBOX is None:
        lons = [c[0] for c in g["node_coord"].values()]
        lats = [c[1] for c in g["node_coord"].values()]
        _BBOX = (min(lons), min(lats), max(lons), max(lats))
    return _BBOX

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
            "tactilePaving": tactile[:30], "riskPoints": risk[:40]}  # kerbs only (steps have own layer)

def _build_route(g, path, profile, rid, variant, o, d):
    nc, cache = g["node_coord"], g["cache"]
    dist = steps = dark = incl = crime = 0.0
    noise_vals = []; step_pts = []; unlit_pts = []; noisy_pts = []
    for i in range(len(path) - 1):
        rec = cache[tuple(sorted((path[i], path[i + 1])))]
        dist += rec["L"]; steps += rec["steps"]; dark += rec["darkness"]
        incl += rec["incline"]; crime += rec["crime"]; noise_vals.append(rec["noise"])
        if rec["steps"]:
            step_pts.append(nc[path[i]])
        if rec["darkness"]:
            unlit_pts.append(nc[path[i]])
        if rec["noise"] >= 0.6:
            noisy_pts.append(nc[path[i]])
    n_edges = max(1, len(path) - 1)
    noise_avg = sum(noise_vals) / len(noise_vals) if noise_vals else 0.0
    crime_avg = crime / n_edges
    steps_seg = int(steps)

    path_nc = [nc[n] for n in path]                       # [lon,lat]
    mf = _map_features(path_nc, step_pts)
    mf["unlit"] = [{"type": "unlit", "lat": p[1], "lng": p[0],
                    "reason": "Unlit segment", "severity": "risk"} for p in unlit_pts][:30]
    mf["noisy"] = [{"type": "noisy", "lat": p[1], "lng": p[0],
                    "reason": "Noisy road", "severity": "caution"} for p in noisy_pts][:30]
    crossings_n = len(mf["crossings"]); tactile_n = len(mf["tactilePaving"])

    mid = path_nc[len(path_nc) // 2]
    air_idx = data.get_air(mid[1], mid[0]).get("air_index")
    signals = {
        "accessibility": _CLAMP(100 - steps_seg * 20 - incl * 8 - max(0, crossings_n - tactile_n) * 4),
        "safety":        _CLAMP(100 - crime_avg * 0.25),            # crime density (City-calibrated)
        "quiet":         _CLAMP(100 - noise_avg * 80),              # road noise
        "lighting":      _CLAMP(100 - dark * 6),                    # explicit unlit segments
        "air":           _CLAMP(100 - (air_idx - 1) * 10) if air_idx else 60,
    }
    w = SCORE_W.get(profile, SCORE_W["general"])
    score = _CLAMP(sum(signals[k] * w[k] for k in SIGNAL_KEYS))

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
        "signals": signals,
        "evidence": ev,
        "mapFeatures": mf,
    }

def get_scored_routes(start, end, profile="general", strict=False):
    """Plan scored, map-ready routes. start/end = (lat,lon) | 'lat,lon' | place name.
    strict=True forces accessibility: drops the length cap + (wheelchair/elderly) avoids
    steps when a step-free option exists."""
    g = _graph()
    try:
        o, d = _resolve(start), _resolve(end)
    except ValueError:
        return {"error": "Couldn't find that place. Try a City of London spot "
                "(Barbican, Bank, St Paul's, Liverpool Street, Farringdon, Aldgate…) or 'lat,lon'.",
                "routes": []}
    w_, s_, e_, n_ = _coverage_bbox(g)
    M = 0.003
    for nm, p in (("Start", o), ("Destination", d)):
        if not (w_ - M <= p[1] <= e_ + M and s_ - M <= p[0] <= n_ + M):
            return {"error": f"{nm} is outside the City of London area we currently cover "
                    "(roughly the Square Mile: Barbican–Aldgate–Blackfriars). Pick a City "
                    "location — coverage expands by re-ingesting a larger OSM area.",
                    "start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]}, "routes": []}
    nc = g["node_coord"]
    s = RE._nearest_node((o[1], o[0]), nc)
    t = RE._nearest_node((d[1], d[0]), nc)

    variants = [("personalized", ROUTE_PROFILES.get(profile, {})),
                ("fastest", {}),
                ("safest", ROUTE_PROFILES["night_safety"]),
                ("quietest", {"steps": 3, "noise": 5.0})]
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

    # Length-cap baseline = the fastest route the persona can actually USE — a
    # steps-laden shortcut isn't a fair baseline for blind/wheelchair/elderly.
    if profile in ("blind", "wheelchair", "elderly"):
        viable = [r for r in routes if not r["mapFeatures"]["steps"]] or routes
    else:
        viable = routes
    baseline = min(r["distanceM"] for r in viable)
    if strict:                                   # force full accessibility — drop the length cap
        pool = routes
        if profile in ("wheelchair", "elderly"):
            step_free = [r for r in pool if not r["mapFeatures"]["steps"]]
            if step_free:
                pool = step_free
    else:                                        # exclude routes >50% longer than the viable-fastest
        pool = [r for r in routes if r["distanceM"] <= baseline * LENGTH_CAP] or routes
    recommended = max(pool, key=lambda r: r["score"])["id"]

    return {"start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]},
            "profile": profile, "strict": strict, "recommended_id": recommended, "routes": routes}


PERSONAS = ("general", "blind", "wheelchair", "elderly", "night_safety")

def get_persona_comparison(start, end):
    """One recommended route per persona for the same OD — to overlay on one map."""
    g = _graph()
    try:
        o, d = _resolve(start), _resolve(end)
    except ValueError:
        return {"error": "Couldn't find that place. Try a City of London spot or 'lat,lon'.", "routes": []}
    w_, s_, e_, n_ = _coverage_bbox(g); M = 0.003
    for nm, p in (("Start", o), ("Destination", d)):
        if not (w_ - M <= p[1] <= e_ + M and s_ - M <= p[0] <= n_ + M):
            return {"error": f"{nm} is outside the City of London area we currently cover.", "routes": []}
    out = []
    for prof in PERSONAS:
        r = get_scored_routes(o, d, prof)            # resolved coords -> no re-geocode
        if r.get("error"):
            continue
        # use the persona's own weighted geometry (max divergence for the overlay),
        # falling back to the recommended route
        pers = (next((x for x in r["routes"] if x["variant"] == "personalized"), None)
                or next((x for x in r["routes"] if x["id"] == r["recommended_id"]), None))
        if pers:
            out.append({**pers, "persona": prof})
    return {"start": {"lat": o[0], "lng": o[1]}, "end": {"lat": d[0], "lng": d[1]}, "routes": out}


if __name__ == "__main__":
    import json
    OD = ("barbican", "st paul's")
    for prof in ["general", "blind", "wheelchair", "night_safety"]:
        r = get_scored_routes(*OD, prof)
        if "error" in r:
            print(f"[{prof}] {r['error']}"); continue
        rec = next(x for x in r["routes"] if x["id"] == r["recommended_id"])
        sig = " ".join(f"{k[:3]}={rec['signals'][k]}" for k in SIGNAL_KEYS)
        print(f"[{prof:12}] rec={r['recommended_id']} score={rec['score']} "
              f"{rec['distanceM']}m/{rec['etaMin']}min | {sig} "
              f"| variants={[x['id']+':'+str(x['distanceM'])+'m' for x in r['routes']]}")
