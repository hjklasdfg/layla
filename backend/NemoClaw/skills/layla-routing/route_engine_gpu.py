"""GPU shortest-path backend for Layla (RAPIDS cuGraph).

Same fused edge weights as the CPU path (route_engine._edge_cost) — only the
shortest-path step moves to the GPU. Activated by LAYLA_GPU=1; route_engine
falls back to the CPU Dijkstra if anything here raises.

Per-edge static terms are built once per process (NOT pickled onto the graph);
each request only recomputes the scalar weight column on the GPU and runs
cugraph.sssp, so different profiles/preferences are cheap.

Tested API (RAPIDS 25.06): cugraph.sssp(G, src) -> DataFrame[distance, vertex,
predecessor]; predecessor == -1 at the source / for unreachable vertices.
"""
from __future__ import annotations

_cudf = None
_cugraph = None
_IDX = None          # process-local static index (built from the graph once)


def _lazy():
    global _cudf, _cugraph
    if _cudf is None:
        import cudf
        import cugraph
        _cudf, _cugraph = cudf, cugraph
    return _cudf, _cugraph


def _build_index(g):
    """Build node<->int ids and the static per-edge term columns (once)."""
    global _IDX
    if _IDX is not None:
        return _IDX
    cudf, _ = _lazy()
    keys = list(g["node_coord"].keys())
    key2id = {k: i for i, k in enumerate(keys)}
    src, dst, L = [], [], []
    steps, incline, darkness, crime, air, tactile, noise, crowd = ([] for _ in range(8))
    for (a, b), rec in g["cache"].items():
        src.append(key2id[a]); dst.append(key2id[b]); L.append(rec["L"])
        steps.append(rec["steps"]); incline.append(rec["incline"])
        darkness.append(rec["darkness"])
        crime.append(min(rec["crime"] / 20.0, 1.0))      # pre-clamped, matches _edge_cost
        air.append(min(rec["air"] / 10.0, 1.0))
        tactile.append(rec["tactile"]); noise.append(rec["noise"]); crowd.append(rec["crowd"])
    edf = cudf.DataFrame({"src": src, "dst": dst, "L": L, "steps": steps,
                          "incline": incline, "darkness": darkness, "crime": crime,
                          "air": air, "tactile": tactile, "noise": noise, "crowd": crowd})
    _IDX = {"key2id": key2id, "id2key": keys, "edf": edf}
    return _IDX


def shortest_path(g, s, t, w):
    """Return the node-key path from s to t under weights w, or None.
    Mirrors route_engine._edge_cost: cost = L * (1 + Σ w·term)."""
    cudf, cugraph = _lazy()
    idx = _build_index(g)
    k2i, i2k, edf = idx["key2id"], idx["id2key"], idx["edf"]
    if s not in k2i or t not in k2i:
        return None
    weight = edf["L"] * (1.0
        + float(w.get("steps", 0))    * edf["steps"]
        + float(w.get("incline", 0))  * edf["incline"]
        + float(w.get("darkness", 0)) * edf["darkness"]
        + float(w.get("crime", 0))    * edf["crime"]
        + float(w.get("air", 0))      * edf["air"]
        + float(w.get("tactile", 0))  * edf["tactile"]
        + float(w.get("noise", 0))    * edf["noise"]
        + float(w.get("crowd", 0))    * edf["crowd"])
    gdf = cudf.DataFrame({"src": edf["src"], "dst": edf["dst"], "weight": weight})
    G = cugraph.Graph(directed=False)
    G.from_cudf_edgelist(gdf, source="src", destination="dst", edge_attr="weight")
    res = cugraph.sssp(G, k2i[s]).to_pandas()
    pred = dict(zip(res["vertex"].astype("int64"), res["predecessor"].astype("int64")))
    dist = dict(zip(res["vertex"].astype("int64"), res["distance"]))
    si, ti = k2i[s], k2i[t]
    if ti not in dist or dist[ti] >= 1e300:           # unreachable
        return None
    path = [ti]
    while path[-1] != si:
        p = pred.get(path[-1], -1)
        if p < 0:
            return None
        path.append(int(p))
    path.reverse()
    return [i2k[i] for i in path]
