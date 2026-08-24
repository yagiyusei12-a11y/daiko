"""Exclusive lock for portal HTML generation (single VPS)."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import IO, Optional


def portal_generate_lock_path(root: Path) -> Path:
    return root / "logs" / "portal-generate.lock"


def acquire_portal_generate_lock(root: Path) -> Optional[IO[str]]:
    lock_dir = root / "logs"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = portal_generate_lock_path(root)
    fp = open(lock_path, "a+", encoding="utf-8")
    try:
        if os.name == "nt":
            import msvcrt

            fp.seek(0)
            if fp.read(1) == "":
                fp.write("0")
                fp.flush()
            fp.seek(0)
            msvcrt.locking(fp.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fp.seek(0)
        fp.truncate()
        fp.write(str(os.getpid()))
        fp.flush()
        return fp
    except OSError:
        fp.close()
        return None


def release_portal_generate_lock(handle: Optional[IO[str]]) -> None:
    if handle is None:
        return
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
    handle.close()


def main(argv: list[str] | None = None) -> int:
    """CLI helper for tests: acquire once, or hold for --seconds N."""
    args = list(sys.argv[1:] if argv is None else argv)
    root_arg = next((a for a in args if not a.startswith("-") and a != "--hold"), None)
    root = Path(root_arg).resolve() if root_arg else Path(__file__).resolve().parents[1]
    hold_seconds = 0
    if "--hold" in args:
        hold_seconds = 30
    if "--seconds" in args:
        idx = args.index("--seconds")
        if idx + 1 < len(args):
            hold_seconds = int(args[idx + 1])
    handle = acquire_portal_generate_lock(root)
    if handle is None:
        print("already_running", flush=True)
        return 0
    print("acquired", flush=True)
    try:
        if hold_seconds > 0:
            import time

            time.sleep(hold_seconds)
    finally:
        release_portal_generate_lock(handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
