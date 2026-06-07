#!/usr/bin/env python3
"""Layla agent — the NemoClaw skill-orchestration layer for "Ask Layla anything".

A small ReAct-style loop: Nemotron (local on the DGX Spark) is given the
`layla-data` skill's tools and decides which to call (it may chain several),
each call runs the real ingested-data function, then Nemotron summarises using
the actual numbers. This is the agentic alternative to a hand-coded pipeline —
the model picks the tools.

Protocol (JSON, no native tool-calling needed — robust on the reasoning model):
  model -> {"tool":"<name>","args":{...}}      (we run it, return TOOL RESULT)
  model -> {"answer":"..."}                     (done)
"""
import json
import os
import urllib.request

import route_scoring as rs   # gives _resolve + rs.data (the layla-data skill)

NEMOTRON_URL = os.environ.get("NEMOTRON_BASE_URL", "http://localhost:18000").rstrip("/")
MODEL = os.environ.get(
    "NEMOTRON_MODEL", "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4"
)


def _nemotron(messages, max_tokens=320, temperature=0.2):
    body = json.dumps(
        {"model": MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    ).encode()
    req = urllib.request.Request(
        NEMOTRON_URL + "/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as r:   # noqa: S310 (trusted internal URL)
        d = json.loads(r.read())
    m = d["choices"][0]["message"]
    return (m.get("content") or m.get("reasoning") or "").strip()


# ---------------------------------------------------------------- tools
def _t_area_info(place=None):
    """Safety / noise / air / accessibility near a named London place."""
    if not place:
        return {"error": "no place given"}
    lat, lon = rs._resolve(place)
    ctx = rs.data.get_context(lat, lon, 250)
    cats = {}
    for f in ctx.get("accessibility_nearby", []):
        c = f.get("category") or "other"
        cats[c] = cats.get(c, 0) + 1
    return {
        "place": place,
        "crime_count_nearby": ctx.get("crime_count_nearby"),
        "noise": ctx.get("noise"),
        "air": ctx.get("air"),
        "accessibility_counts": cats,
        "accessibility_total": sum(cats.values()),
    }


def _t_transit_status():
    """Live TfL tube/DLR/Overground line status (delays/closures)."""
    return rs.data.get_line_status()


TOOLS = {
    "area_info": {
        "fn": _t_area_info,
        "args": ["place"],
        "desc": "Safety (crime count), noise dB, air, and accessibility features (tactile paving / "
        "crossings / kerbs / steps) near a named London place.",
    },
    "transit_status": {
        "fn": _t_transit_status,
        "args": [],
        "desc": "Live TfL tube / DLR / Overground line status — delays and closures.",
    },
}


def _tools_help():
    return "; ".join(
        f'{k}({", ".join(v["args"])}) — {v["desc"]}' for k, v in TOOLS.items()
    )


SYS = (
    "/no_think You are Layla's data agent for London accessibility & mobility. You answer by "
    "calling tools and then summarising. TOOLS: " + _tools_help() + ". "
    'Reply with ONE JSON object and nothing else. To call a tool: {"tool":"<name>","args":{...}}. '
    "You may call several tools (one per reply) before answering — e.g. ask about safety AND transit. "
    'After each TOOL RESULT, call another tool or finish: {"answer":"<1-2 warm sentences using the real numbers>"}. '
    "Interpret honestly: a high nearby-crime count = less safe; more tactile paving / crossings = more "
    "accessible; higher dB = noisier. If data is missing say you do not have it — never invent."
)


def _extract_json(s):
    """First balanced {...} object in the string (model may add fences/prose)."""
    i = s.find("{")
    while i != -1:
        depth = 0
        for j in range(i, len(s)):
            if s[j] == "{":
                depth += 1
            elif s[j] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[i : j + 1])
                    except json.JSONDecodeError:
                        break
        i = s.find("{", i + 1)
    return None


def run_agent(question, context=None, max_steps=4):
    """Returns {answer, trace[], via}. trace lists the tool calls the agent made."""
    ctx_note = ""
    if context and (context.get("destination") or context.get("start")):
        ctx_note = (
            f' (journey context — start="{context.get("start", "")}", '
            f'destination="{context.get("destination", "")}"; resolve "my destination"->destination, '
            '"my start"/"here"->start)'
        )
    msgs = [
        {"role": "system", "content": SYS},
        {"role": "user", "content": question + ctx_note},
    ]
    trace = []
    for _ in range(max_steps):
        out = _nemotron(msgs)
        m = _extract_json(out)
        if not m:
            return {"answer": out[:400] or "Sorry, I could not work that out.", "trace": trace, "via": "nemoclaw-agent"}
        if "answer" in m:
            return {"answer": str(m["answer"]), "trace": trace, "via": "nemoclaw-agent"}
        tool = m.get("tool")
        args = m.get("args") or {}
        if tool not in TOOLS:
            msgs.append({"role": "user", "content": f"TOOL ERROR: unknown tool {tool!r}. Valid: {list(TOOLS)}"})
            continue
        spec = TOOLS[tool]
        try:
            result = spec["fn"](**{a: args.get(a) for a in spec["args"]})
        except Exception as e:                       # noqa: BLE001
            result = {"error": str(e)[:140]}
        trace.append({"tool": tool, "args": args})
        msgs.append({"role": "assistant", "content": json.dumps(m)})
        msgs.append({"role": "user", "content": "TOOL RESULT: " + json.dumps(result)[:1600]})
    # out of steps -> force a final answer from what we have
    msgs.append({"role": "user", "content": 'Now finish with {"answer":"..."} using what you have.'})
    m = _extract_json(_nemotron(msgs)) or {}
    return {"answer": str(m.get("answer", "Sorry, I could not work that out.")), "trace": trace, "via": "nemoclaw-agent"}


if __name__ == "__main__":   # quick manual test
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "Is it safe and quiet around Bank?"
    print(json.dumps(run_agent(q), indent=2))
