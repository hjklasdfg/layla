#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""CLI entry point for the layla-data skill.

Usage:
  python scripts/query.py <function> [args...]

Functions and their positional args:
  get_accessibility  <west> <south> <east> <north>
  get_crime          <west> <south> <east> <north> [since]
  get_noise          <lat> <lon>
  get_air            <lat> <lon>
  get_context        <lat> <lon> [radius_m]
  get_walkable_graph <west> <south> <east> <north>
  get_live_disruptions
  get_crowding       <naptan>
  get_line_status    [modes]
  get_road_disruptions [west south east north]

All output is JSON printed to stdout.
"""
import json
import sys
import os

# Add the skill root to path so layla_data_skill is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import layla_data_skill as data


def _bbox(args, offset=0):
    w, s, e, n = float(args[offset]), float(args[offset+1]), float(args[offset+2]), float(args[offset+3])
    return (w, s, e, n)


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    fn = sys.argv[1]
    args = sys.argv[2:]

    try:
        if fn == "get_accessibility":
            result = data.get_accessibility(_bbox(args))
        elif fn == "get_crime":
            bbox = _bbox(args)
            since = args[4] if len(args) > 4 else None
            result = data.get_crime(bbox, since=since)
        elif fn == "get_noise":
            result = data.get_noise(float(args[0]), float(args[1]))
        elif fn == "get_air":
            result = data.get_air(float(args[0]), float(args[1]))
        elif fn == "get_context":
            radius = float(args[2]) if len(args) > 2 else 150
            result = data.get_context(float(args[0]), float(args[1]), radius)
        elif fn == "get_walkable_graph":
            result = data.get_walkable_graph(_bbox(args))
        elif fn == "get_live_disruptions":
            result = data.get_live_disruptions()
        elif fn == "get_crowding":
            result = data.get_crowding(args[0])
        elif fn == "get_line_status":
            modes = args[0] if args else "tube,dlr,elizabeth-line,overground"
            result = data.get_line_status(modes)
        elif fn == "get_road_disruptions":
            bbox = _bbox(args) if len(args) >= 4 else None
            result = data.get_road_disruptions(bbox)
        else:
            print(json.dumps({"error": f"unknown function: {fn}"}))
            sys.exit(1)

        print(json.dumps(result))

    except (IndexError, ValueError) as e:
        print(json.dumps({"error": f"bad args for {fn}: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
