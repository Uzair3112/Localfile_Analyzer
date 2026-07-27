import fnmatch
from pathlib import Path


def should_ignore_path(
    rel_path: Path,
    settings: dict,
    is_dir: bool = False,
) -> bool:
    parts = rel_path.parts
    ignore_hidden = settings.get("ignore_hidden", True)
    ignore_node_modules = settings.get("ignore_node_modules", True)
    custom_globs = settings.get("custom_ignore_globs", [])

    for part in parts:
        if ignore_hidden and part.startswith("."):
            return True
        if ignore_node_modules and part == "node_modules":
            return True

    if custom_globs:
        str_path = str(rel_path).replace("\\", "/")
        for pattern in custom_globs:
            if fnmatch.fnmatch(str_path, pattern):
                return True
            if fnmatch.fnmatch(rel_path.name, pattern):
                return True

    return False
