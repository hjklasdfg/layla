"""Layla — preference-weighted accessible route engine (framework-agnostic core).

Pure stdlib. Builds a walking graph from OSM footways, overlays preference
"weight layers" (accessibility / crime / air / lighting), and routes A->B with
a per-persona weight profile. Returns a route + a spoken briefing.

Data (relative to this file):
  layla_osm_footways.geojson        routable footway network (LineStrings)
  safety/crime_cityoflondon.json    crime points (data.police.uk)
  env/air_index_london.json         air-quality sites + index (London Air)

This is the LOGIC core. Wrap as a NemoClaw skill / tool later — the public
function `plan_accessible_route(origin, dest, persona)` is the seam.
"""
from __future__ import annotations
import json, os, math, heapq
from collections import defaultdict

DATA_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Persona = a weight profile over the layers. cost = length * (1 + Σ w·score) ---
PERSONAS = {
    "default":      {},                                   # shortest distance
    "blind":        {"steps": 6.0, "tactile": 1.0},       # avoid steps
    "wheelchair":   {"steps": 8.0, "incline": 4.0},       # avoid steps + slopes
    "night_safety": {"crime": 5.0, "darkness": 3.0},      # avoid crime + unlit
    "respiratory":  {"air": 5.0},                         # avoid pollution
    "sensory":      {"noise": 5.0, "crowd": 5.0},         # autism / guide dog (noise/crowd data TODO)
}

WALK_SPEED_MPS = 1.33  # ~4.8 km/h


# --- geo helpers ---
def _haversine(a, b):           # a, b = (lon, lat)
    R = 6371000.0
    lon1, lat1 = a; lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def _key(c, prec=6):            # snap float coord to a hashable node id
    return (round(c[0], prec), round(c[1], prec))


# --- load layers ---
def _load_graph():
    fc = json.load(open(os.path.join(DATA_DIR, "layla_osm_footways.geojson")))
    adj = defaultdict(list); node_coord = {}
    for f in fc["features"]:
        coords = f["geometry"]["coordinates"]; t = f["properties"]
        attrs = {"highway": t.get("highway"), "lit": t.get("lit"),
                 "incline": t.get("incline"), "name": t.get("name")}
        for i in range(len(coords) - 1):
            a, b = _key(coords[i]), _key(coords[i + 1])
            node_coord[a] = coords[i]; node_coord[b] = coords[i + 1]
            L = _haversine(coords[i], coords[i + 1])
            adj[a].append((b, L, attrs)); adj[b].append((a, L, attrs))
    return adj, node_coord

def _snap_bridges(adj, node_coord, tol=8.0, cell=0.0004):
    """Bridge tiny gaps between way ENDPOINTS (degree<=1 nodes) within `tol`
    metres so the pedestrian graph stays routable — without exploding the edge
    count on a dense (road + footway) network."""
    endpoints = [n for n in node_coord if len(adj[n]) <= 1]
    grid = defaultdict(list)
    for n, c in node_coord.items():
        grid[(int(c[0] / cell), int(c[1] / cell))].append(n)
    added = 0
    for n in endpoints:
        c = node_coord[n]
        gx, gy = int(c[0] / cell), int(c[1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m in grid.get((gx + dx, gy + dy), []):
                    if m == n:
                        continue
                    d = _haversine(c, node_coord[m])
                    if 0 < d <= tol:
                        link = {"highway": "link", "lit": None, "incline": None, "name": None}
                        adj[n].append((m, d, link)); adj[m].append((n, d, link)); added += 1
    return added

def _load_crime_grid(cell=0.002):
    grid = defaultdict(list); n = 0
    geo = os.path.join(DATA_DIR, "crime_cityoflondon_points.geojson")
    legacy = os.path.join(DATA_DIR, "safety", "crime_cityoflondon.json")
    if os.path.exists(geo):                       # consolidated points (preferred)
        for f in json.load(open(geo)).get("features", []):
            try:
                lon, lat = f["geometry"]["coordinates"][:2]
            except (KeyError, TypeError, ValueError):
                continue
            grid[(int(lon / cell), int(lat / cell))].append((lon, lat)); n += 1
    elif os.path.exists(legacy):                  # legacy API json (fallback)
        for x in json.load(open(legacy)):
            loc = x.get("location") or {}
            try:
                p = (float(loc["longitude"]), float(loc["latitude"]))
            except (KeyError, TypeError, ValueError):
                continue
            grid[(int(p[0] / cell), int(p[1] / cell))].append(p); n += 1
    return grid, cell, n

def _crime_near(mid, grid, cell, radius=90.0):
    gx, gy = int(mid[0] / cell), int(mid[1] / cell); n = 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for p in grid.get((gx + dx, gy + dy), []):
                if _haversine(mid, p) <= radius:
                    n += 1
    return n

def _load_air_sites():
    sites = []
    try:
        a = json.load(open(os.path.join(DATA_DIR, "env", "air_index_london.json")))
        root = a.get("HourlyAirQualityIndex", a)
        las = root.get("LocalAuthority", [])
        if isinstance(las, dict): las = [las]
        for la in las:
            ss = la.get("Site", [])
            if isinstance(ss, dict): ss = [ss]
            for s in ss:
                try:
                    lon, lat = float(s["@Longitude"]), float(s["@Latitude"])
                except (KeyError, TypeError, ValueError):
                    continue
                sp = s.get("Species", [])
                if isinstance(sp, dict): sp = [sp]
                idxs = []
                for x in sp:
                    v = x.get("@AirQualityIndex")
                    if v and str(v).isdigit() and int(v) > 0 and x.get("@AirQualityBand") not in (None, "No data"):
                        idxs.append(int(v))
                if idxs:
                    sites.append((lon, lat, max(idxs)))   # worst pollutant index at the site
    except FileNotFoundError:
        pass
    return sites

def _air_near(mid, sites):
    if not sites:
        return 0
    return min(sites, key=lambda s: _haversine(mid, (s[0], s[1])))[2]


# --- per-edge scores (precomputed once) ---
def _edge_record(u, v, L, attrs, node_coord, crime_grid, ccell, air_sites):
    mid = ((node_coord[u][0] + node_coord[v][0]) / 2,
           (node_coord[u][1] + node_coord[v][1]) / 2)
    lit = attrs.get("lit")
    return {
        "L": L,
        "name": attrs.get("name"),
        "steps": 1.0 if attrs.get("highway") == "steps" else 0.0,
        "incline": 1.0 if attrs.get("incline") else 0.0,
        "darkness": 1.0 if lit == "no" else 0.0,        # only explicit lit=no penalised
        "crime": _crime_near(mid, crime_grid, ccell),    # raw count
        "air": _air_near(mid, air_sites),                # 0..10ish
        "tactile": 0.0, "noise": 0.0, "crowd": 0.0,      # placeholders for future layers
    }

def _edge_cost(rec, w):
    pen = (w.get("steps", 0)    * rec["steps"]
         + w.get("incline", 0)  * rec["incline"]
         + w.get("darkness", 0) * rec["darkness"]
         + w.get("crime", 0)    * min(rec["crime"] / 20.0, 1.0)
         + w.get("air", 0)      * min(rec["air"] / 10.0, 1.0)
         + w.get("tactile", 0)  * rec["tactile"]
         + w.get("noise", 0)    * rec["noise"]
         + w.get("crowd", 0)    * rec["crowd"])
    return rec["L"] * (1.0 + pen)


# --- routing ---
def _nearest_node(coord, node_coord):
    return min(node_coord, key=lambda n: _haversine(coord, node_coord[n]))

def _dijkstra(adj, start, goal, w, cache):
    dist = {start: 0.0}; prev = {}; pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal:
            break
        if d > dist.get(u, 1e18):
            continue
        for v, _L, _a in adj[u]:
            rec = cache[tuple(sorted((u, v)))]
            nd = d + _edge_cost(rec, w)
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if goal not in dist:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    return path


# build the scored graph once, reuse across personas
_CACHEKEY = {}
def _build():
    adj, node_coord = _load_graph()
    bridges = _snap_bridges(adj, node_coord)
    crime_grid, ccell, crime_n = _load_crime_grid()
    air_sites = _load_air_sites()
    cache = {}
    for u in adj:
        for v, L, attrs in adj[u]:
            k = tuple(sorted((u, v)))
            if k not in cache:
                cache[k] = _edge_record(u, v, L, attrs, node_coord, crime_grid, ccell, air_sites)
    return {"adj": adj, "node_coord": node_coord, "cache": cache,
            "stats": {"nodes": len(node_coord), "edges": len(cache),
                      "bridges": bridges, "crime_points": crime_n, "air_sites": len(air_sites)}}


def _briefing(persona, dist_m, mins, m):
    out = [f"Planned a {persona.replace('_',' ')} route: about {round(dist_m)} m, ~{mins} min walk."]
    if m["steps_seg"]:
        out.append(f"{m['steps_seg']} step section(s) on the way." if persona not in ("blind","wheelchair")
                   else f"Routed to minimise steps ({m['steps_seg']} unavoidable section(s)).")
    if persona == "night_safety":
        out.append(f"Chosen to keep clear of higher-crime stretches; {m['dark_seg']} unlit segment(s).")
    if persona == "respiratory":
        out.append(f"Kept to lower-pollution streets (peak air index ~{m['air_max']}).")
    return " ".join(out)


def plan_accessible_route(origin, dest, persona="default", graph=None):
    """origin, dest = (lat, lon). Returns a route dict + spoken briefing."""
    g = graph or _build()
    adj, nc, cache = g["adj"], g["node_coord"], g["cache"]
    o, d = (origin[1], origin[0]), (dest[1], dest[0])     # -> (lon,lat)
    s, t = _nearest_node(o, nc), _nearest_node(d, nc)
    w = PERSONAS.get(persona, {})
    path = _dijkstra(adj, s, t, w, cache)
    if not path:
        return {"error": "no route found (graph disconnected between these points)"}
    dist_m = 0.0; m = {"steps_seg": 0, "dark_seg": 0, "crime_sum": 0, "air_max": 0}
    streets = []
    for i in range(len(path) - 1):
        rec = cache[tuple(sorted((path[i], path[i + 1])))]
        dist_m += rec["L"]
        m["steps_seg"] += int(rec["steps"]); m["dark_seg"] += int(rec["darkness"])
        m["crime_sum"] += rec["crime"]; m["air_max"] = max(m["air_max"], rec["air"])
        if rec["name"] and (not streets or streets[-1] != rec["name"]):
            streets.append(rec["name"])
    mins = round(dist_m / WALK_SPEED_MPS / 60)
    return {
        "persona": persona,
        "distance_m": round(dist_m),
        "duration_min": mins,
        "streets": streets,
        "metrics": m,
        "path_lonlat": [nc[n] for n in path],
        "briefing": _briefing(persona, dist_m, mins, m),
    }


if __name__ == "__main__":
    g = _build()
    print("graph:", g["stats"], "\n")
    # Same A -> B, different persona => different route/cost. (City of London corridor)
    origin = (51.5205, -0.0972)   # near Barbican
    dest   = (51.5158, -0.0925)   # toward Moorgate/Bank
    for persona in ["default", "blind", "wheelchair", "night_safety", "respiratory"]:
        r = plan_accessible_route(origin, dest, persona, graph=g)
        if "error" in r:
            print(f"[{persona}] {r['error']}"); continue
        print(f"[{persona:12}] {r['distance_m']}m / {r['duration_min']}min | "
              f"steps={r['metrics']['steps_seg']} dark={r['metrics']['dark_seg']} "
              f"crimeΣ={r['metrics']['crime_sum']} airMax={r['metrics']['air_max']}")
        print(f"               briefing: {r['briefing']}")
