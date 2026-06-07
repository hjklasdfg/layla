#!/usr/bin/env python3
"""Isolated shortest-path KERNEL benchmark: CPU single-source Dijkstra (to ALL
nodes) vs cuGraph SSSP, on the loaded fused-weight graph.

This strips away the surrounding Python (nearest-node O(N) scan, geometry build,
per-edge scoring) so the cuGraph graph-compute win is visible. It's an
apples-to-apples single-source-to-all comparison (= a reachability/isochrone
query, which is the shape cuGraph accelerates). Run inside the RAPIDS container.
"""
import os, sys, time, heapq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route_scoring as rs            # noqa: E402
import route_engine as RE             # noqa: E402
from route_engine import _edge_cost   # noqa: E402

g = rs._graph()
print("graph:", g["stats"])
adj, cache, nc = g["adj"], g["cache"], g["node_coord"]
W = rs.ROUTE_PROFILES["wheelchair"]            # fused routing weights
w_, s_, e_, n_ = rs._coverage_bbox(g)
src_key = RE._nearest_node((w_ + 0.006, s_ + 0.006), nc)

# ---- CPU: full single-source Dijkstra to ALL reachable nodes ----
def cpu_sssp(start):
    dist = {start: 0.0}
    pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e18):
            continue
        for v, _L, _a in adj[u]:
            rec = cache[tuple(sorted((u, v)))]
            nd = d + _edge_cost(rec, W)
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist

t = time.time()
dcpu = cpu_sssp(src_key)
cpu_t = time.time() - t
print(f"CPU full Dijkstra (single-source -> all): {cpu_t:.2f}s  ({len(dcpu)} nodes reached)")

# ---- GPU: cuGraph SSSP on the same weighted graph ----
import cudf            # noqa: E402
import cugraph         # noqa: E402
try:
    import rmm
    rmm.reinitialize(managed_memory=True)        # GB10 unified memory
except Exception:       # noqa: BLE001
    pass
import route_engine_gpu as GPU                    # noqa: E402

idx = GPU._build_index(g)
edf = idx["edf"]
weight = edf["L"] * (1.0
    + float(W.get("steps", 0))    * edf["steps"]
    + float(W.get("incline", 0))  * edf["incline"]
    + float(W.get("darkness", 0)) * edf["darkness"]
    + float(W.get("crime", 0))    * edf["crime"]
    + float(W.get("air", 0))      * edf["air"]
    + float(W.get("tactile", 0))  * edf["tactile"]
    + float(W.get("noise", 0))    * edf["noise"]
    + float(W.get("crowd", 0))    * edf["crowd"])
gdf = cudf.DataFrame({"src": edf["src"], "dst": edf["dst"], "weight": weight})
src_id = idx["key2id"][src_key]

def gpu_sssp():
    G = cugraph.Graph(directed=False)
    G.from_cudf_edgelist(gdf, source="src", destination="dst", edge_attr="weight")
    return cugraph.sssp(G, src_id)

_ = gpu_sssp()                                     # warmup (JIT, allocations)
runs = []
for _i in range(3):
    t = time.time()
    res = gpu_sssp()
    runs.append(time.time() - t)
gpu_t = sorted(runs)[len(runs) // 2]
print(f"GPU cuGraph SSSP: {gpu_t * 1000:.0f} ms  ({len(res)} rows)")
print(f"\n>>> KERNEL SPEEDUP: {cpu_t / gpu_t:.0f}x   (CPU {cpu_t:.2f}s  vs  GPU {gpu_t * 1000:.0f} ms)")
