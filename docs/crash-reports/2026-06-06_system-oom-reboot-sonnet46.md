# System OOM Reboot — 2026-06-06

**Host:** hp-07  
**Boot that crashed:** 20:09–20:25 (16 minutes)  
**Current boot:** started 20:26

---

## Root Cause

**Out of Memory (RAM + GPU VRAM exhausted simultaneously)**

The `openclaw-gateway.service` loaded the `vllm/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4` model (30B parameters). vLLM workers consumed ~27GB virtual memory each, exhausting both system RAM (121GB total) and GPU VRAM. The gateway auto-restarted after each OOM kill and consumed even more memory on restart, triggering a second OOM event before the manual reboot.

---

## Timeline

| Time     | Event |
|----------|-------|
| 20:09    | System booted; `openclaw-gateway.service` started loading Nemotron 30B via vLLM |
| 20:09–20:20 | vLLM workers running (PIDs ~41001, 45389 each with ~27GB virtual); CPU pegged at 100% across 6+ cores |
| 20:20:27 | **OOM kill #1**: `openclaw-gateway` PID 3137 (180MB RSS) killed; Nautilus PID 99541 killed as collateral; GPU VRAM OOM reported by NVRM |
| 20:20    | `openclaw-gateway.service` auto-restarted by systemd |
| 20:24:51 | **OOM kill #2**: `openclaw-gateway` PID 102003 (478MB RSS, growing) killed again |
| 20:25:32 | Manual reboot (clean shutdown, not a kernel panic) |

---

## Evidence from Logs

```
# OOM kill #1
Jun 06 20:20:27 kernel: oom-kill: task_memcg=/user.slice/.../openclaw-gateway.service, task=MainThread, pid=3137
Jun 06 20:20:27 kernel: Out of memory: Killed process 3137 (MainThread) total-vm:1603960kB, anon-rss:180804kB

# GPU VRAM OOM (simultaneous)
Jun 06 20:20:27 kernel: NVRM: nvCheckOkFailedNoLog: Check failed: Out of memory [NV_ERR_NO_MEMORY]
Jun 06 20:20:27 kernel:   returned from _memdescAllocInternal(pMemDesc) @ mem_desc.c:1359

# OOM kill #2 (after auto-restart)
Jun 06 20:24:51 kernel: oom-kill: task_memcg=/user.slice/.../openclaw-gateway.service, task=MainThread, pid=102003
Jun 06 20:24:51 kernel: Out of memory: Killed process 102003 (MainThread) total-vm:1701544kB, anon-rss:478836kB

# CPU usage — user-1000.slice consumed 1h 38min in 16 minutes wall clock
Jun 06 20:25:23 systemd: user-1000.slice: Consumed 1h 36min 43.887s CPU time
```

---

## Why CPU Was 100%

The vLLM inference workers for the 30B model ran full-tilt. `user-1000.slice` consumed **1h 38min of CPU time in ~16 minutes of wall clock** — approximately 6+ cores pegged continuously. The openclaw gateway model was configured as:

```
agent model: vllm/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 (thinking=medium, fast=off)
```

---

## Contributing Factors

- Docker + containerd + cloudflared + tailscaled all running alongside vLLM, competing for RAM
- `openclaw-gateway.service` has no `MemoryMax=` limit — systemd auto-restarts it unconditionally after OOM kill, causing an OOM loop
- vLLM has no `--gpu-memory-utilization` cap configured, so it claims as much VRAM as available
- 16GB swap insufficient as overflow buffer for a 30B model workload

---

## Current State (after reboot at 20:26)

```
RAM:   121GB total, 74GB used, 21GB free
Swap:  15GB total, 0 used
```

The model appears loaded again in the current boot.

---

## Recommendations

1. **Add a memory limit** to the openclaw-gateway systemd unit:
   ```ini
   [Service]
   MemoryMax=8G
   MemorySwapMax=0
   ```

2. **Cap vLLM GPU memory utilization** (e.g. `--gpu-memory-utilization 0.85`) to leave headroom for other GPU processes.

3. **Disable auto-restart on OOM** or add a restart backoff to prevent the OOM loop:
   ```ini
   [Service]
   RestartSec=30
   StartLimitIntervalSec=120
   StartLimitBurst=2
   ```

4. **Monitor GPU VRAM** before and during model load — `nvidia-smi` should be checked at startup.
