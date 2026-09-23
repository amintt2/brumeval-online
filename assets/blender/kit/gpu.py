"""Cycles GPU (HIP on the AMD RX 6650 XT) + a cross-process GPU lock.

Several Blender processes run in parallel (one per asset agent). Only ONE of them may use the GPU at a time
(8 GB VRAM, and concurrent HIP contexts thrash). Usage:

    from kit import gpu
    with gpu.device(scene, samples=16) as dev:      # dev == 'GPU' or 'CPU'
        bpy.ops.object.bake(type='EMIT')

The lock is a file in the temp dir (brumeval_gpu.lock) holding "pid time". It is considered stale when the
owning process is dead or the lock is older than STALE_S. If the lock stays busy longer than `wait` seconds
the block runs on the CPU instead (never blocks forever). Set BRUMEVAL_FORCE_CPU=1 to skip the GPU entirely.
"""
import contextlib
import os
import sys
import tempfile
import time

import bpy

LOCK_PATH = os.path.join(tempfile.gettempdir(), "brumeval_gpu.lock")
STALE_S = 20 * 60          # a single bake/render never legitimately holds the GPU this long
DEFAULT_WAIT = 240         # seconds to wait for the GPU before falling back to CPU
_state = {"hip": None, "held": 0, "type": None}


def _log(msg):
    print(f"[gpu] {msg}", flush=True)


def _pid_alive(pid):
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _read_lock():
    try:
        with open(LOCK_PATH, "r") as f:
            pid, t = f.read().split()[:2]
        return int(pid), float(t)
    except Exception:
        return None


def try_acquire():
    """Non-blocking attempt. Returns True if this process now holds the lock."""
    if _state["held"]:
        _state["held"] += 1
        return True
    for _ in range(2):
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {time.time():.0f}".encode())
            os.close(fd)
            _state["held"] = 1
            return True
        except FileExistsError:
            info = _read_lock()
            stale = info is None and (time.time() - _mtime()) > 30
            if info is not None:
                pid, t = info
                stale = (not _pid_alive(pid)) or (time.time() - t > STALE_S) or pid == os.getpid()
            if not stale:
                return False
            _log(f"removing stale lock {info}")
            with contextlib.suppress(OSError):
                os.remove(LOCK_PATH)
    return False


def _mtime():
    try:
        return os.path.getmtime(LOCK_PATH)
    except OSError:
        return time.time()


def release():
    if _state["held"] > 1:
        _state["held"] -= 1
        return
    if _state["held"] == 1:
        _state["held"] = 0
        info = _read_lock()
        if info and info[0] == os.getpid():
            with contextlib.suppress(OSError):
                os.remove(LOCK_PATH)


def acquire(wait=DEFAULT_WAIT):
    """Blocking acquire with timeout. Returns True if acquired."""
    t0 = time.time()
    warned = False
    while True:
        if try_acquire():
            return True
        if time.time() - t0 > wait:
            return False
        if not warned:
            _log(f"GPU busy ({_read_lock()}), waiting up to {wait}s...")
            warned = True
        time.sleep(1.0)


def _prefs():
    try:
        return bpy.context.preferences.addons["cycles"].preferences
    except (KeyError, AttributeError):
        return None


def prefs_ok(dev_type=None):
    """True when the Cycles add-on preferences CURRENTLY point at a GPU backend with at least one enabled device.
    (common.reset() -> read_factory_settings() wipes these preferences, so never trust a cached answer.)"""
    prefs = _prefs()
    if prefs is None:
        return False
    t = dev_type or _state.get("type")
    if not t or prefs.compute_device_type != t:
        return False
    return any(d.use and d.type == t for d in prefs.devices)


def enable_hip():
    """Enable the HIP device(s) in the Cycles add-on preferences. Returns True if a GPU device is usable.

    Only the negative answer ("no GPU on this machine / HIP broken") is cached. When a GPU backend was found
    before, the preferences are RE-CHECKED on every call and re-applied if something reset them (the
    read_factory_settings() of common.reset() does exactly that) -- otherwise Cycles would silently render on
    the CPU while the kit believes it uses the GPU."""
    if os.environ.get("BRUMEVAL_FORCE_CPU") == "1":
        return False
    if _state["hip"] is False:
        return False
    if _state["hip"] and prefs_ok():
        return True
    ok = False
    try:
        prefs = _prefs()
        order = ("HIP", "CUDA", "OPTIX", "ONEAPI")
        if _state.get("type"):
            order = (_state["type"],) + tuple(t for t in order if t != _state["type"])
        for t in order:
            try:
                prefs.compute_device_type = t
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == t]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == t
                ok = True
                if _state["hip"] is None:
                    _log(f"{t}: {[d.name for d in gpus]}")
                else:
                    _log(f"{t} preferences were reset (factory settings?) -> re-enabled {[d.name for d in gpus]}")
                _state["type"] = t
                break
    except Exception as e:  # pragma: no cover
        _log(f"GPU init failed: {e}")
    _state["hip"] = ok
    if not ok:
        _log("no GPU device, using CPU")
    return ok


def self_test():
    """Regression check for the 'factory reset silently drops the GPU' bug. Returns a dict; raises on failure
    when a GPU was available before the reset."""
    first = enable_hip()
    before = prefs_ok()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    wiped = not prefs_ok()
    second = enable_hip()
    after = prefs_ok()
    res = {"gpu": first, "configured_before": before, "reset_wiped_prefs": wiped, "gpu_after_reset": second,
           "configured_after": after}
    _log(f"self-test {res}")
    if first and not (second and after):
        raise RuntimeError(f"kit.gpu self-test FAILED: GPU lost after factory reset {res}")
    return res


def setup_cycles(scene=None, samples=16, device="GPU"):
    scene = scene or bpy.context.scene
    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.device = device
    c.samples = samples
    c.use_denoising = False
    c.use_adaptive_sampling = False
    try:
        c.use_auto_tile = False
    except AttributeError:
        pass
    return scene


@contextlib.contextmanager
def device(scene=None, samples=16, wait=DEFAULT_WAIT, prefer_gpu=True):
    """Context manager: Cycles on GPU while holding the cross-process lock, else CPU. Yields 'GPU' or 'CPU'."""
    scene = scene or bpy.context.scene
    use_gpu = prefer_gpu and enable_hip() and acquire(wait)
    if prefer_gpu and _state["hip"] and not use_gpu:
        _log("GPU lock busy too long -> CPU fallback")
    if use_gpu and not prefs_ok():           # belt and braces: never claim GPU while Cycles would use the CPU
        _log("Cycles GPU preferences not active -> CPU")
        release()
        use_gpu = False
    setup_cycles(scene, samples, "GPU" if use_gpu else "CPU")
    try:
        yield "GPU" if use_gpu else "CPU"
    finally:
        if use_gpu:
            release()


@contextlib.contextmanager
def lock_only(wait=DEFAULT_WAIT):
    """Hold the GPU lock for a non-Cycles GPU job (e.g. EEVEE QA renders). Yields True if held.
    EEVEE always uses the GPU; if the lock is busy too long we render anyway (EEVEE is light)."""
    held = acquire(wait)
    try:
        yield held
    finally:
        if held:
            release()
