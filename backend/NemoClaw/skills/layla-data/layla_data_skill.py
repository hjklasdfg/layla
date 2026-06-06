"""Layla — unified City-of-London data skill (framework-agnostic core).

ONE interface the agent (NemoClaw) calls to access every ingested data layer.
We ingest RAW open data (OSM, Met/City Police crime, London Air, DEFRA noise,
TfL) and fuse it locally; routing is NOT done here — we hand back the walkable
graph + per-edge attributes for the routing layer to weight.

Public functions (all return plain JSON-serialisable dicts/lists):
  get_accessibility(bbox)      crossings / tactile / kerb / steps
  get_crime(bbox, since=None)  crime points + breakdown by type
  get_noise(lat, lon)          road-noise dB band at a point
  get_air(lat, lon)            nearest air-quality index
  get_walkable_graph(bbox)     nodes + edges + fused per-edge attributes  ← routing consumes this
  get_context(lat, lon, r)     "what's around me" (accessibility+crime+noise+air)
  get_live_disruptions()       TfL lift outages (live; cached fallback)
  get_crowding(naptan)         TfL station crowding (live; cached fallback)

Data files live next to this module (layla-data/).
"""
from __future__ import annotations
import json, os, math
from functools import lru_cache

DIR = os.path.dirname(os.path.abspath(__file__))


# ---------- geo helpers ----------
def _haversine(a, b):  # (lon,lat)
    R = 6371000.0
    (lo1, la1), (lo2, la2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def _in_bbox(lon, lat, b):  # b = (w,s,e,n)
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]

def _point_in_ring(lon, lat, ring):
    inside = False; n = len(ring); j = n - 1
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-18) + xi):
            inside = not inside
        j = i
    return inside


# ---------- raw layer loaders (cached) ----------
@lru_cache(maxsize=1)
def _accessibility():
    return json.load(open(os.path.join(DIR, "layla_osm_accessibility.geojson")))["features"]

@lru_cache(maxsize=1)
def _footways():
    return json.load(open(os.path.join(DIR, "layla_osm_footways.geojson")))["features"]

@lru_cache(maxsize=1)
def _crime():
    fp = os.path.join(DIR, "crime_cityoflondon_points.geojson")
    if not os.path.exists(fp):
        fp = os.path.join(DIR, "safety", "crime_cityoflondon.json")  # fallback
        raw = json.load(open(fp))
        return [{"lon": float(x["location"]["longitude"]), "lat": float(x["location"]["latitude"]),
                 "type": x.get("category", "")} for x in raw if x.get("location")]
    return [{"lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1],
             "type": f["properties"].get("crime_type", "")} for f in json.load(open(fp))["features"]]

@lru_cache(maxsize=1)
def _crime_grid(cell=0.002):
    g = {}
    for p in _crime():
        k = (int(p["lon"]/cell), int(p["lat"]/cell)); g.setdefault(k, []).append(p)
    return g, cell

def _band_db(b):
    if not b: return None
    if b.startswith(">="): return 77.0
    if "-" in b:
        lo, hi = b.split("-"); return (float(lo) + float(hi)) / 2
    return None

@lru_cache(maxsize=1)
def _noise():
    feats = json.load(open(os.path.join(DIR, "noise_road_cityoflondon.geojson")))["features"]
    out = []
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        out.append({"ring": ring, "bbox": (min(xs), min(ys), max(xs), max(ys)),
                    "db": _band_db(f["properties"].get("NoiseClass")),
                    "band": f["properties"].get("NoiseClass")})
    return out

@lru_cache(maxsize=1)
def _air_sites():
    a = json.load(open(os.path.join(DIR, "env", "air_index_london.json")))
    root = a.get("HourlyAirQualityIndex", a); las = root.get("LocalAuthority", [])
    if isinstance(las, dict): las = [las]
    sites = []
    for la in las:
        ss = la.get("Site", [])
        if isinstance(ss, dict): ss = [ss]
        for s in ss:
            try: lon, lat = float(s["@Longitude"]), float(s["@Latitude"])
            except (KeyError, TypeError, ValueError): continue
            sp = s.get("Species", [])
            if isinstance(sp, dict): sp = [sp]
            idx = [int(x["@AirQualityIndex"]) for x in sp
                   if str(x.get("@AirQualityIndex", "")).isdigit() and x.get("@AirQualityBand") not in (None, "No data")]
            if idx: sites.append({"lon": lon, "lat": lat, "index": max(idx), "name": s.get("@SiteName", "")})
    return sites


# ---------- public skill functions ----------
def get_accessibility(bbox):
    """bbox=(w,s,e,n). Returns accessibility point features inside the box."""
    out = []
    for f in _accessibility():
        lon, lat = f["geometry"]["coordinates"]
        if _in_bbox(lon, lat, bbox):
            p = f["properties"]
            out.append({"lat": lat, "lon": lon, "category": p.get("category"),
                        "tags": {k: v for k, v in p.items() if k not in ("osm_id", "category")}})
    return {"count": len(out), "features": out}

def get_crime(bbox, since=None):
    """Crime points in bbox (optionally month >= 'YYYY-MM'), with breakdown by type."""
    pts = [p for p in _crime() if _in_bbox(p["lon"], p["lat"], bbox)]
    by = {}
    for p in pts: by[p["type"]] = by.get(p["type"], 0) + 1
    return {"count": len(pts), "by_type": dict(sorted(by.items(), key=lambda x: -x[1])),
            "points": [{"lat": p["lat"], "lon": p["lon"], "type": p["type"]} for p in pts]}

def _crime_near(lon, lat, radius=90.0):
    g, cell = _crime_grid()
    gx, gy = int(lon/cell), int(lat/cell); n = 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for p in g.get((gx+dx, gy+dy), []):
                if _haversine((lon, lat), (p["lon"], p["lat"])) <= radius: n += 1
    return n

def get_noise(lat, lon):
    """Road-noise dB band at a point (point-in-polygon over the noise layer)."""
    for poly in _noise():
        b = poly["bbox"]
        if b[0] <= lon <= b[2] and b[1] <= lat <= b[3] and _point_in_ring(lon, lat, poly["ring"]):
            return {"lat": lat, "lon": lon, "noise_db": poly["db"], "band": poly["band"]}
    return {"lat": lat, "lon": lon, "noise_db": None, "band": None}

def get_air(lat, lon):
    """Nearest air-quality monitoring site index to a point."""
    sites = _air_sites()
    if not sites: return {"lat": lat, "lon": lon, "air_index": None}
    s = min(sites, key=lambda s: _haversine((lon, lat), (s["lon"], s["lat"])))
    return {"lat": lat, "lon": lon, "air_index": s["index"], "nearest_site": s["name"],
            "dist_m": round(_haversine((lon, lat), (s["lon"], s["lat"])))}

def get_walkable_graph(bbox):
    """Nodes + edges of the walkable network in bbox, each edge carrying fused
    attributes for the routing layer to weight. Routing is NOT done here."""
    nodes = {}; edges = []
    def nid(c): return (round(c[0], 6), round(c[1], 6))
    for f in _footways():
        coords = f["geometry"]["coordinates"]; t = f["properties"]
        if not any(_in_bbox(lo, la, bbox) for lo, la in coords): continue
        for i in range(len(coords) - 1):
            a, b = coords[i], coords[i+1]
            na, nb = nid(a), nid(b)
            nodes[na] = {"lat": a[1], "lon": a[0]}; nodes[nb] = {"lat": b[1], "lon": b[0]}
            mid = ((a[0]+b[0])/2, (a[1]+b[1])/2)
            edges.append({
                "from": list(na), "to": list(nb),
                "length_m": round(_haversine(a, b), 1),
                "highway": t.get("highway"), "lit": t.get("lit"),
                "is_steps": t.get("highway") == "steps",
                "crime_count": _crime_near(mid[0], mid[1]),
                "noise_db": get_noise(mid[1], mid[0])["noise_db"],
                "air_index": get_air(mid[1], mid[0])["air_index"],
            })
    return {"node_count": len(nodes), "edge_count": len(edges),
            "nodes": [{"id": list(k), **v} for k, v in nodes.items()], "edges": edges}

def get_context(lat, lon, radius_m=150):
    """Unified 'what's around me' at a point — for the agent."""
    b = (lon - 0.0025, lat - 0.0018, lon + 0.0025, lat + 0.0018)
    acc = [f for f in get_accessibility(b)["features"]
           if _haversine((lon, lat), (f["lon"], f["lat"])) <= radius_m]
    return {"lat": lat, "lon": lon, "radius_m": radius_m,
            "accessibility_nearby": acc,
            "crime_count_nearby": _crime_near(lon, lat, radius_m),
            "noise": get_noise(lat, lon), "air": get_air(lat, lon)}


# ---------- live TfL (env key, cached fallback) ----------
def _tfl(path):
    import requests
    key = os.getenv("TFL_APP_KEY")
    if not key: raise RuntimeError("no key")
    r = requests.get(f"https://api.tfl.gov.uk{path}",
                     params={"app_key": key}, timeout=15)
    r.raise_for_status(); return r.json()

def get_live_disruptions():
    """TfL lift outages (step-free breakage). Live if TFL_APP_KEY set, else cached snapshot."""
    try:
        data = _tfl("/Disruptions/Lifts/v2"); src = "live"
    except Exception:
        data = json.load(open(os.path.join(DIR, "tfl", "lift_disruptions.json"))); src = "cached"
    return {"source": src, "count": len(data),
            "disruptions": [{"station_id": d.get("stationUniqueId"), "message": d.get("message")} for d in data]}

def get_crowding(naptan):
    """TfL live station crowding (percentageOfBaseline). Live if TFL_APP_KEY set, else cached."""
    try:
        d = _tfl(f"/Crowding/{naptan}/Live"); src = "live"
    except Exception:
        d = json.load(open(os.path.join(DIR, "tfl", "crowding_barbican.json"))); src = "cached"
    return {"source": src, "naptan": naptan, "percentage_of_baseline": d.get("percentageOfBaseline"),
            "time": d.get("timeLocal") or d.get("timeUtc")}

def get_line_status(modes="tube,dlr,elizabeth-line,overground"):
    """TfL line status/disruptions for the given modes (live). Reliability signal."""
    try:
        data = _tfl(f"/Line/Mode/{modes}/Status")
    except Exception:
        return {"source": "unavailable", "lines": []}
    lines = []
    for ln in data:
        sts = ln.get("lineStatuses") or []
        worst = min(sts, key=lambda s: s.get("statusSeverity", 10)) if sts else {}
        lines.append({"line": ln.get("name"), "mode": ln.get("modeName"),
                      "status": worst.get("statusSeverityDescription"),
                      "reason": worst.get("reason")})
    return {"source": "live", "count": len(lines), "lines": lines}

def get_road_disruptions(bbox=None):
    """TfL road disruptions / roadworks (live). bbox=(w,s,e,n) filters to coords in box."""
    try:
        data = _tfl("/Road/all/Disruption")
    except Exception:
        return {"source": "unavailable", "disruptions": []}
    out = []
    for d in data:
        lat = lon = None
        coords = (d.get("geography") or {}).get("coordinates")
        if isinstance(coords, list) and len(coords) >= 2:
            try:
                lon, lat = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                lat = lon = None
        if bbox is not None and (lat is None or not _in_bbox(lon, lat, bbox)):
            continue
        out.append({"severity": d.get("severity"), "category": d.get("category"),
                    "location": d.get("location"),
                    "description": (d.get("comments") or d.get("currentUpdate") or "")[:160],
                    "lat": lat, "lon": lon})
    return {"source": "live", "count": len(out), "disruptions": out[:50]}


if __name__ == "__main__":
    CORRIDOR = (-0.100, 51.515, -0.090, 51.522)
    print("== get_accessibility(corridor) =="); print(json.dumps({k: get_accessibility(CORRIDOR)[k] for k in ("count",)}))
    print("== get_crime(corridor) =="); c = get_crime(CORRIDOR); print({"count": c["count"], "by_type": dict(list(c["by_type"].items())[:4])})
    print("== get_noise(Barbican) =="); print(get_noise(51.5203, -0.0972))
    print("== get_air(Barbican) =="); print(get_air(51.5203, -0.0972))
    print("== get_context(Barbican) =="); ctx = get_context(51.5203, -0.0972); print({"accessibility_nearby": len(ctx["accessibility_nearby"]), "crime_count_nearby": ctx["crime_count_nearby"], "noise": ctx["noise"]["band"], "air": ctx["air"]["air_index"]})
    print("== get_walkable_graph(corridor) =="); g = get_walkable_graph(CORRIDOR); print({"node_count": g["node_count"], "edge_count": g["edge_count"], "sample_edge": g["edges"][0]})
    print("== get_live_disruptions() =="); d = get_live_disruptions(); print({"source": d["source"], "count": d["count"], "first": d["disruptions"][0] if d["disruptions"] else None})
    print("== get_line_status() =="); ls = get_line_status(); print({"source": ls["source"], "count": ls.get("count"), "sample": ls["lines"][:3]})
    print("== get_road_disruptions() =="); rd = get_road_disruptions(); print({"source": rd["source"], "count": rd.get("count"), "first": rd["disruptions"][0] if rd["disruptions"] else None})
