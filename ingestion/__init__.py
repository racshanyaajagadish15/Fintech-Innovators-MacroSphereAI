"""News ingestion: API adapters and stream (Kafka or in-memory)."""
from .adapters import NewsAdapterRegistry, get_standardized_news
from .stream import get_news_stream

__all__ = ["NewsAdapterRegistry", "get_standardized_news", "get_news_stream"]
