from __future__ import annotations


class MemoryArchiveError(RuntimeError):
    pass


class EmbeddingUnavailable(MemoryArchiveError):
    pass


class SummaryGenerationFailed(MemoryArchiveError):
    pass
