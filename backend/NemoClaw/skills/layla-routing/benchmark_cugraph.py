#!/usr/bin/env python3
"""CPU (heapq Dijkstra) vs GPU (cuGraph SSSP) on the loaded graph.

Run twice on the Spark after ingesting a large graph:
    LAYLA_GPU=0 python benchmark_cugraph.py
    LAYLA_GPU=1 python benchmark_cugraph.py
First run builds + pickle-caches the graph; both then time the SAME long OD
(opposite corners of the coverage bbox) so the comparison is apples-to-apples
(both compute 4 route variants per request).
"""
import os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route_engine as RE          # noqa: E402
import route_scoring as rs         # noqa: E402

MODE = "GPU(cuGraph)" if RE._GPU else "CPU(Dijkstra)"

t = time.time()
g = rs._graph()
print(f"[{MODE}] graph build/load: {time.time() - t:.1f}s  stats={g['stats']}")

w, s, e, n = rs._coverage_bbox(g)
origin = f"{s + 0.006:.5f},{w + 0.006:.5f}"        # SW-ish corner
dest = f"{n - 0.006:.5f},{e - 0.006:.5f}"          # NE-ish corner
print(f"[{MODE}] OD {origin} -> {dest}  (long cross-graph route)")

times = []
for i in range(3):
    t = time.time()
    r = rs.get_scored_routes(origin, dest, "wheelchair", "most_accessible")
    dt = time.time() - t
    times.append(dt)
    if r.get("error"):
        print(f"[{MODE}] route {i + 1}: {dt:.2f}s  ERR {r['error'][:50]}")
    else:
        rec = next(x for x in r["routes"] if x["id"] == r["recommended_id"])
        print(f"[{MODE}] route {i + 1}: {dt:.2f}s  rec={r['recommended_id']} {rec['distanceM']}m "
              f"{len(rec['geometry']['coordinates'])}pts")

times.sort()
print(f"[{MODE}] median per-request: {times[len(times) // 2]:.2f}s")
