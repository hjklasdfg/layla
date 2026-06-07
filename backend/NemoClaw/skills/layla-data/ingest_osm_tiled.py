#!/usr/bin/env python3
"""Tiled OSM ingest for a LARGE bbox — a single Overpass query times out at scale.

Splits the bbox into a grid, fetches each tile, merges (dedup by osm_id), and
overwrites layla_osm_footways.geojson + layla_osm_accessibility.geojson with the
big graph used for the cuGraph performance demo.

  BBOX="S,W,N,E" GRID="3x3" python ingest_osm_tiled.py
Default: a central-London bbox ~5x the Triton<->City corridor.
"""
import json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OVERPASS = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
BBOX = os.environ.get("BBOX", "51.49,-0.18,51.55,-0.06")  # S,W,N,E central London
GRID = os.environ.get("GRID", "3x3")


def _q(query):
    for attempt in range(5):
        try:
            body = urllib.parse.urlencode({"data": query}).encode()
            req = urllib.request.Request(
                OVERPASS, data=body,
                headers={"User-Agent": "Layla/0.1 (hackathon tiled ingest)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:                       # noqa: BLE001
            print(f"    overpass retry {attempt + 1}/5: {e}", file=sys.stderr)
            time.sleep(15)
    raise RuntimeError("overpass failed")


def _tiles(bbox, rows, cols):
    s, w, n, e = [float(x) for x in bbox.split(",")]
    dy, dx = (n - s) / rows, (e - w) / cols
    for i in range(rows):
        for j in range(cols):
            yield (s + i * dy, w + j * dx, s + (i + 1) * dy, w + (j + 1) * dx)


def main():
    rows, cols = [int(x) for x in GRID.lower().split("x")]
    cells = list(_tiles(BBOX, rows, cols))
    ways, nodes = {}, {}
    print(f"bbox={BBOX} grid={GRID} ({len(cells)} tiles)")
    for k, (s, w, n, e) in enumerate(cells, 1):
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        print(f"  tile {k}/{len(cells)} {bb} ...", flush=True)
        wq = _q(f'[out:json][timeout:240];way["highway"]'
                f'["highway"!~"motorway|motorway_link|construction|proposed|raceway|bus_guideway"]'
                f'({bb});out geom tags;')
        for el in wq.get("elements", []):
            if el.get("type") != "way" or "geometry" not in el or el["id"] in ways:
                continue
            coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
            if len(coords) < 2:
                continue
            t = el.get("tags", {})
            ways[el["id"]] = {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"osm_id": el["id"], "category": "footway",
                               "highway": t.get("highway"), "lit": t.get("lit"),
                               "incline": t.get("incline"), "name": t.get("name")}}
        nq = _q(f'[out:json][timeout:180];('
                f'node["highway"="crossing"]({bb});'
                f'node["tactile_paving"]({bb});'
                f'node["kerb"]({bb}););out;')
        for el in nq.get("elements", []):
            if el.get("type") != "node" or el["id"] in nodes:
                continue
            t = el.get("tags", {})
            if t.get("tactile_paving") in ("yes", "contrasted"):
                cat = "tactile_paving"
            elif t.get("highway") == "crossing":
                cat = "crossing"
            elif "kerb" in t:
                cat = "kerb"
            else:
                continue
            p = {"osm_id": el["id"], "category": cat}
            p.update({key: t[key] for key in ("highway", "tactile_paving", "kerb", "crossing") if key in t})
            nodes[el["id"]] = {"type": "Feature",
                               "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
                               "properties": p}
        print(f"    cumulative: ways={len(ways)} nodes={len(nodes)}", flush=True)

    json.dump({"type": "FeatureCollection", "features": list(ways.values())},
              open(os.path.join(HERE, "layla_osm_footways.geojson"), "w"))
    json.dump({"type": "FeatureCollection", "features": list(nodes.values())},
              open(os.path.join(HERE, "layla_osm_accessibility.geojson"), "w"))
    print(f"DONE  footways={len(ways)}  accessibility={len(nodes)}")


if __name__ == "__main__":
    main()
