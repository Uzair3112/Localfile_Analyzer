import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss", ".less",
    ".md", ".txt", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bat", ".ps1", ".sql", ".rb", ".java", ".cpp", ".c", ".h", ".hpp",
    ".rs", ".go", ".swift", ".kt", ".scala", ".php", ".pl", ".lua", ".r",
    ".vue", ".svelte", ".astro", ".env", ".gitignore", ".dockerfile",
    ".gradle", ".properties", ".lock",
}


def is_text_file(filepath: Path) -> bool:
    if filepath.suffix.lower() in _TEXT_EXTENSIONS:
        return True
    try:
        with open(filepath, "rb") as f:
            chunk = f.read(8192)
        chunk.decode("utf-8")
        return True
    except (UnicodeDecodeError, OSError):
        return False


def count_lines(filepath: Path) -> int:
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0
