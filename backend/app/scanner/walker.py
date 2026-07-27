import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from app.scanner.ignore_rules import should_ignore_path

logger = logging.getLogger(__name__)

WalkResult = tuple[Path, os.stat_result]


def _walk_recursive(
    dir_path: Path,
    root: Path,
    settings: dict,
) -> Generator[WalkResult, None, None]:
    max_size = settings.get("max_file_size", 52428800)
    try:
        with os.scandir(dir_path) as it:
            for entry in it:
                try:
                    rel_path = Path(entry.path).relative_to(root)
                except ValueError:
                    continue

                try:
                    if entry.is_dir(follow_symlinks=False):
                        if should_ignore_path(rel_path, settings, is_dir=True):
                            continue
                        yield from _walk_recursive(
                            Path(entry.path), root, settings
                        )
                    elif entry.is_file(follow_symlinks=False):
                        if should_ignore_path(rel_path, settings, is_dir=False):
                            continue
                        stat = entry.stat()
                        if max_size > 0 and stat.st_size > max_size:
                            continue
                        yield (Path(entry.path), stat)
                except OSError:
                    continue
    except (PermissionError, OSError):
        pass


def walk_folder(
    folder_path: str,
    settings: dict,
) -> Generator[WalkResult, None, None]:
    root = Path(folder_path).resolve()
    if not root.is_dir():
        logger.warning("walk_folder: %s is not a directory", folder_path)
        return
    yield from _walk_recursive(root, root, settings)


def extract_file_metadata(
    file_path: Path,
    stat: os.stat_result,
) -> dict:
    return {
        "filename": file_path.name,
        "full_path": str(file_path),
        "extension": file_path.suffix.lower() or None,
        "size": stat.st_size,
        "created_at": datetime.fromtimestamp(
            stat.st_ctime, tz=timezone.utc
        ),
        "modified_at": datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ),
    }
