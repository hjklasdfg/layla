# GPT-5.5 System OOM Report — 2026-06-06

Found it. The machine was not primarily failing from disk, thermal, or a kernel panic. It was under severe memory pressure and hit repeated OOM kills.

## Timeline

- 19:49 boot started.
- 20:05 memory pressure began; swap was effectively full:
    - Free swap = 52kB
    - Total swap = 16777212kB

- 20:05:28, 20:06:12, 20:07:29: kernel OOM killer fired repeatedly.
- OOM victims included openclaw-gateway.service, gnome-terminal, and evolution-alarm.
- openclaw-gateway.service was killed and restarted repeatedly.
- 20:07:51 and 20:08:00: journal logged Power key pressed short.
- Boot ended abruptly around 20:08:03; the next boot reported the journal as "corrupted or uncleanly shut down".
- On the next boot, memory pressure recurred around 20:20; OpenClaw was OOM-killed again, NVIDIA driver logged repeated NV_ERR_NO_MEMORY, and GDM/X sessions began failing.
- 20:25:22: final shutdown was cleanly requested by another Power key pressed short.

## Current State After Reboot

- RAM is OK now: about 43GiB available, swap unused.
- vllm-active is using about 9.8GiB system RAM and ~64.9GiB GPU memory.
- openshell-my-assistant... is still restart-looping because it cannot fetch policy from the OpenShell server, but it is only using about 12MiB right now.

## Most Likely Cause

openclaw-gateway.service plus its spawned MainThread/sandbox workload created enough memory pressure to exhaust RAM/swap. The user-visible reboot/poweroff was then triggered via the power button while the system was already degraded.
