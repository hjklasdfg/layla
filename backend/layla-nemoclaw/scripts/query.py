#!/usr/bin/env python3
"""CLI for each layla-nemoclaw skill. Output is JSON on stdout."""
import importlib.util
import json
import os
import sys

_ROOT = os.path.join(os.path.dirname(__file__), "..")
_SKILLS = os.path.join(_ROOT, "skills")


def _load(module_name: str, filename: str):
    path = os.path.join(_SKILLS, module_name, filename)
    spec = importlib.util.spec_from_file_location(f"skill_{module_name}", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        print("""
Functions:
  analyse_image     <image_path>
  resolve_location  <lat> <lng>
  search_authority  <borough> <hazard_type>
  prepare_content   (JSON stdin: hazard, location, user_profile?)
  prepare_email     (JSON stdin: content, authority)
""")
        sys.exit(0)

    fn = sys.argv[1]
    args = sys.argv[2:]

    try:
        if fn == "analyse_image":
            mod = _load("analyse-image", "analyse_image.py")
            result = mod.run(args[0])
        elif fn == "resolve_location":
            mod = _load("resolve-location", "resolve_location.py")
            result = mod.run(float(args[0]), float(args[1]))
        elif fn == "search_authority":
            mod = _load("search-authority", "search_authority.py")
            location = {"borough": args[0]}
            result = mod.run(location, args[1])
        elif fn == "prepare_content":
            mod = _load("prepare-content", "prepare_content.py")
            payload = json.load(sys.stdin)
            result = mod.run(
                payload["hazard"],
                payload["location"],
                payload.get("user_profile", "general"),
            )
        elif fn == "prepare_email":
            mod = _load("prepare-email", "prepare_email.py")
            payload = json.load(sys.stdin)
            result = mod.run(payload["content"], payload["authority"])
        else:
            print(json.dumps({"error": f"unknown function: {fn}"}))
            sys.exit(1)

        print(json.dumps(result))

    except (IndexError, ValueError, KeyError) as e:
        print(json.dumps({"error": f"bad args for {fn}: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
