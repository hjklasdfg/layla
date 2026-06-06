#!/usr/bin/env python3
"""Ingest the OSM walkable network + accessibility points for a bbox via Overpass.

Writes (overwrites) layla_osm_footways.geojson + layla_osm_accessibility.geojson
next to this file. This is the data step that determines routable coverage; the
graph rebuilds from these. For all-London at scale, run this per-tile (or from a
Geofabrik PBF) and route on GPU (cuGraph) — the pure-Python engine handles a
central-London bbox, not all of Greater London.

Usage:
    python ingest_osm.py                      # default central-London corridor
    BBOX="S,W,N,E" python ingest_osm.py       # custom bbox (lat,lon order)
"""
import json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OVERPASS = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
# S,W,N,E — Triton Square (Regent's Place) <-> the City of London
BBOX = os.environ.get("BBOX", "51.505,-0.150,51.535,-0.072")


def _q(query):
    for attempt in range(4):
        try:
            body = urllib.parse.urlencode({"data": query}).encode()
            req = urllib.request.Request(
                OVERPASS, data=body,
                headers={"User-Agent": "Layla/0.1 (hackathon accessibility ingest)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:                       # noqa: BLE001
            print(f"  overpass retry {attempt + 1}/4: {e}", file=sys.stderr)
            time.sleep(12)
    raise RuntimeError("overpass failed after retries")


def main():
    bbox = BBOX
    print(f"bbox (S,W,N,E) = {bbox}")

    print("fetching walkable ways ...")
    ways = _q(f'[out:json][timeout:240];'
              f'way["highway"]["highway"!~"motorway|motorway_link|construction|'
              f'proposed|raceway|bus_guideway"]({bbox});out geom tags;')
    foot = []
    for el in ways.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
        if len(coords) < 2:
            continue
        t = el.get("tags", {})
        foot.append({"type": "Feature",
                     "geometry": {"type": "LineString", "coordinates": coords},
                     "properties": {"osm_id": el["id"], "category": "footway",
                                    "highway": t.get("highway"), "lit": t.get("lit"),
                                    "incline": t.get("incline"), "name": t.get("name")}})
    json.dump({"type": "FeatureCollection", "features": foot},
              open(os.path.join(HERE, "layla_osm_footways.geojson"), "w"))
    print(f"  footways: {len(foot)} ways")

    print("fetching accessibility nodes ...")
    nodes = _q(f'[out:json][timeout:180];('
               f'node["highway"="crossing"]({bbox});'
               f'node["tactile_paving"]({bbox});'
               f'node["kerb"]({bbox}););out;')
    acc = []
    for el in nodes.get("elements", []):
        if el.get("type") != "node":
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
        props = {"osm_id": el["id"], "category": cat}
        props.update({k: t[k] for k in ("highway", "tactile_paving", "kerb", "crossing") if k in t})
        acc.append({"type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
                    "properties": props})
    json.dump({"type": "FeatureCollection", "features": acc},
              open(os.path.join(HERE, "layla_osm_accessibility.geojson"), "w"))
    print(f"  accessibility: {len(acc)} points")
    print("done.")


if __name__ == "__main__":
    main()
