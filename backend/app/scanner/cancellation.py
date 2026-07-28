import threading

_cancelled: dict[int, threading.Event] = {}


def request_cancellation(scan_id: int) -> None:
    if scan_id not in _cancelled:
        _cancelled[scan_id] = threading.Event()
    _cancelled[scan_id].set()


def is_cancellation_requested(scan_id: int) -> bool:
    event = _cancelled.get(scan_id)
    return event is not None and event.is_set()


def clear_cancellation(scan_id: int) -> None:
    _cancelled.pop(scan_id, None)
