"""Generator based pseudo-streaming engine (PRD FR-008)."""

from .generator import TransactionEvent, count_transactions, transaction_stream, validate_record
from .processor import StreamProcessor, get_processor
from .state import StreamState, StreamStatus

__all__ = [
    "StreamProcessor",
    "StreamState",
    "StreamStatus",
    "TransactionEvent",
    "count_transactions",
    "get_processor",
    "transaction_stream",
    "validate_record",
]
