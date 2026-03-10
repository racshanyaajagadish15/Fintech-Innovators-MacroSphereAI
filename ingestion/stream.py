"""Stream abstraction: in-memory queue or Kafka. Consume standardized news."""
import asyncio
from collections import deque
from typing import AsyncIterator
from schemas.news import StandardizedNewsItem


# In-memory queue when Kafka is not configured (per-topic buffers)
_queues: dict[str, deque] = {}
_queue_max = 10_000


def _get_queue(topic: str) -> deque:
    if topic not in _queues:
        _queues[topic] = deque(maxlen=_queue_max)
    return _queues[topic]


async def publish_standardized(topic: str, item: StandardizedNewsItem) -> None:
    """Publish one standardized item to a topic (in-memory)."""
    _get_queue(topic).append(item)


async def consume_standardized(topic: str) -> AsyncIterator[StandardizedNewsItem]:
    """Consume from topic (in-memory). Yields available then waits."""
    q = _get_queue(topic)
    while True:
        while q:
            yield q.popleft()
        await asyncio.sleep(0.5)


def get_news_stream(topic: str = "macrosphere-news-raw"):
    """Return consumer iterator for the given topic."""
    return consume_standardized(topic)
