# OOM Crash Summary — 2026-06-06

## What Happened

The machine was not primarily failing from disk, thermal, or a kernel panic. It was under severe memory pressure and hit repeated OOM kills.

## Timeline

| Time     | Event |
|----------|-------|
| 19:49    | Boot started |
| 20:05    | Memory pressure began; swap effectively full (52kB free of 16777212kB) |
| 20:05:28 | Kernel OOM killer fired |
| 20:06:12 | Kernel OOM killer fired again |
| 20:07:29 | Kernel OOM killer fired again |
| 20:07:51 | Journal: *Power key pressed short* |
| 20:08:00 | Journal: *Power key pressed short* |
| 20:08:03 | Boot ended abruptly; next boot reported journal "corrupted or uncleanly shut down" |
| 20:20    | Next boot: memory pressure recurred; OpenClaw OOM-killed again; NVIDIA driver logged repeated NV_ERR_NO_MEMORY; GDM/X sessions began failing |
| 20:25:22 | Final clean shutdown via Power key |

**OOM victims:** `openclaw-gateway.service`, `gnome-terminal`, `evolution-alarm`  
`openclaw-gateway.service` was killed and auto-restarted repeatedly, re-creating the same pressure each time.

## Current State

- RAM: ~43GiB available, swap unused
- `vllm-active`: 9.8GiB system RAM, ~64.9GiB GPU memory
- `openshell-my-assistant`: restart-looping (cannot fetch policy from OpenShell server), ~12MiB RAM — not a memory concern

## Root Cause

`openclaw-gateway.service` and its spawned MainThread/sandbox workload exhausted all RAM and swap. The power button was pressed by the user while the system was already degraded.

## See Also

- [`system-oom-reboot-2026-06-06.md`](system-oom-reboot-2026-06-06.md) — Claude Sonnet analysis of the same event
- [`gpt55_report.md`](gpt55_report.md) — GPT-5.5 analysis of the same event
