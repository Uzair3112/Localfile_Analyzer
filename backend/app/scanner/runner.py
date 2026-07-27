import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select, insert, func
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.models.scan import Scan, ScanStatus
from app.models.scanned_file import ScannedFile
from app.models.duplicate import Duplicate
from app.scanner.walker import walk_folder, extract_file_metadata
from app.scanner.line_counter import is_text_file, count_lines
from app.scanner.hasher import compute_sha256

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


async def _flush_batch(session: AsyncSession, batch: list[dict]):
    await session.execute(insert(ScannedFile.__table__), batch)
    await session.flush()


async def _detect_and_persist_duplicates(
    session: AsyncSession,
    scan_id: int,
) -> int:
    subq = (
        select(ScannedFile.sha256)
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.sha256.isnot(None),
        )
        .group_by(ScannedFile.sha256)
        .having(func.count(ScannedFile.id) > 1)
        .subquery()
    )

    result = await session.execute(
        select(ScannedFile)
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.sha256.in_(select(subq.c.sha256)),
        )
        .order_by(ScannedFile.sha256, ScannedFile.id)
    )
    candidates = result.scalars().all()

    groups: dict[str, list[ScannedFile]] = defaultdict(list)
    for sf in candidates:
        groups[sf.sha256].append(sf)

    pair_count = 0
    for file_hash, files in groups.items():
        for i in range(len(files)):
            for j in range(i + 1, len(files)):
                dup = Duplicate(
                    scan_id=scan_id,
                    hash=file_hash,
                    file1_id=files[i].id,
                    file2_id=files[j].id,
                )
                session.add(dup)
                pair_count += 1

    if pair_count:
        await session.flush()
        logger.info(
            "Found %d duplicate groups, %d pairs total for scan %s",
            len(groups), pair_count, scan_id,
        )

    return pair_count


def _scan_folder_sync(
    scan_id: int,
    folder_path: str,
    settings: dict,
) -> tuple[list[dict], int, int, int]:
    rows = []
    file_count = 0
    size_acc = 0
    lines_acc = 0
    size_map: dict[int, list[int]] = {}

    for file_path, stat in walk_folder(folder_path, settings):
        idx = len(rows)
        file_count += 1
        size_acc += stat.st_size

        metadata = extract_file_metadata(file_path, stat)
        lc = None
        if is_text_file(file_path):
            lc = count_lines(file_path)
            if lc:
                lines_acc += lc

        rows.append({
            "scan_id": scan_id,
            "filename": metadata["filename"],
            "full_path": metadata["full_path"],
            "extension": metadata["extension"],
            "size": metadata["size"],
            "line_count": lc,
            "sha256": None,
            "created_at": metadata["created_at"],
            "modified_at": metadata["modified_at"],
        })

        size = metadata["size"]
        if size not in size_map:
            size_map[size] = []
        size_map[size].append(idx)

    candidate_sizes = {s for s, indices in size_map.items() if len(indices) >= 2}
    total_candidates = sum(len(size_map[s]) for s in candidate_sizes)

    if candidate_sizes:
        logger.info(
            "Computing SHA-256 for %d duplicate candidates across %d size groups",
            total_candidates, len(candidate_sizes),
        )

    for size in candidate_sizes:
        for idx in size_map[size]:
            full_path = rows[idx]["full_path"]
            try:
                rows[idx]["sha256"] = compute_sha256(full_path)
            except OSError as exc:
                logger.warning("Could not hash %s: %s", full_path, exc)

    return rows, file_count, size_acc, lines_acc


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
        rows, total_files, total_size, total_lines = await loop.run_in_executor(
            None, _scan_folder_sync, scan_id, scan.folder_path, settings,
        )

        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            await _flush_batch(session, chunk)

        await _detect_and_persist_duplicates(session, scan_id)

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
