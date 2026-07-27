import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.models.scan import Scan, ScanStatus

logger = logging.getLogger(__name__)

_TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss", ".less",
    ".md", ".txt", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bat", ".ps1", ".sql", ".rb", ".java", ".cpp", ".c", ".h", ".hpp",
    ".rs", ".go", ".swift", ".kt", ".scala", ".php", ".pl", ".lua", ".r",
    ".vue", ".svelte", ".astro", ".env", ".gitignore", ".dockerfile",
    ".gradle", ".properties", ".lock",
}


def _is_text_file(filepath: Path) -> bool:
    if filepath.suffix.lower() in _TEXT_EXTENSIONS:
        return True
    try:
        with open(filepath, "rb") as f:
            chunk = f.read(8192)
        chunk.decode("utf-8")
        return True
    except (UnicodeDecodeError, OSError):
        return False


def _count_lines(filepath: Path) -> int:
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _should_ignore(rel_parts: tuple[str, ...], settings: dict) -> bool:
    ignore_hidden = settings.get("ignore_hidden", True)
    ignore_node_modules = settings.get("ignore_node_modules", True)
    for part in rel_parts:
        if ignore_hidden and part.startswith("."):
            return True
        if ignore_node_modules and part == "node_modules":
            return True
    return False


def _walk_folder(folder_path: str, settings: dict) -> tuple[int, int, int]:
    total_files = 0
    total_size = 0
    total_lines = 0
    max_file_size = settings.get("max_file_size", 52428800)

    root = Path(folder_path)
    if not root.is_dir():
        return 0, 0, 0

    for entry in root.rglob("*"):
        if not entry.is_file():
            continue

        try:
            rel = entry.relative_to(root)
        except ValueError:
            continue

        if _should_ignore(rel.parts, settings):
            continue

        try:
            stat = entry.stat()
        except OSError:
            continue

        if max_file_size > 0 and stat.st_size > max_file_size:
            continue

        total_files += 1
        total_size += stat.st_size

        if _is_text_file(entry):
            total_lines += _count_lines(entry)

    return total_files, total_size, total_lines


async def run_scan(
    scan_id: int,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    session = session_factory()
    try:
        result = await session.execute(select(Scan).where(Scan.id == scan_id))
        scan = result.scalar_one_or_none()
        if not scan:
            logger.error("Scan %s not found in background task", scan_id)
            return

        scan.status = ScanStatus.running
        scan.started_at = datetime.now(timezone.utc)
        await session.commit()

        settings = scan.settings_snapshot or {}

        loop = asyncio.get_running_loop()
        total_files, total_size, total_lines = await loop.run_in_executor(
            None, _walk_folder, scan.folder_path, settings,
        )

        scan.total_files = total_files
        scan.total_size = total_size
        scan.total_lines = total_lines
        scan.status = ScanStatus.completed
        scan.completed_at = datetime.now(timezone.utc)
        await session.commit()

        logger.info(
            "Scan %s completed: %d files, %d bytes, %d lines",
            scan_id,
            total_files,
            total_size,
            total_lines,
        )

    except Exception as exc:
        logger.exception("Scan %s failed", scan_id)
        try:
            result = await session.execute(select(Scan).where(Scan.id == scan_id))
            scan = result.scalar_one_or_none()
            if scan:
                scan.status = ScanStatus.failed
                scan.error_message = str(exc)
                scan.completed_at = datetime.now(timezone.utc)
                await session.commit()
        except Exception:
            logger.exception("Failed to record scan failure for %s", scan_id)
    finally:
        await session.close()
