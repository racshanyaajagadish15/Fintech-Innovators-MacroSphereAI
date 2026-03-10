"""News API adapters: fetch from external APIs and normalize to StandardizedNewsItem."""
from datetime import datetime
from typing import AsyncIterator
import httpx
from schemas.news import StandardizedNewsItem


def _topic_for_source(source_name: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in source_name).strip("-")
    return f"macrosphere-news-{slug or 'general'}"


def _normalize_date(d: str | int | None) -> str:
    if d is None:
        return datetime.utcnow().strftime("%d/%m/%Y")
    if isinstance(d, (int, float)):
        try:
            return datetime.utcfromtimestamp(int(d)).strftime("%d/%m/%Y")
        except (ValueError, OSError):
            return datetime.utcnow().strftime("%d/%m/%Y")
    if "T" in str(d):
        try:
            dt = datetime.fromisoformat(str(d).replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y")
        except Exception:
            pass
    return str(d) if d else datetime.utcnow().strftime("%d/%m/%Y")


async def _fetch_alpha_vantage(api_key: str) -> AsyncIterator[StandardizedNewsItem]:
    """Alpha Vantage News & Sentiment API."""
    if not api_key:
        return
    url = "https://www.alphavantage.co/query"
    params = {"function": "NEWS_SENTIMENT", "apikey": api_key, "limit": 50}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params)
        if r.status_code != 200:
            return
        data = r.json()
    for item in data.get("feed", [])[:20]:
        yield StandardizedNewsItem(
            platform="Alpha Vantage",
            source_name="Alpha Vantage News Sentiment",
            source_topic=_topic_for_source("alpha-vantage"),
            headline=item.get("title", ""),
            publishing_date=_normalize_date(item.get("time_published")),
            metadata="\n".join(filter(None, [
                item.get("summary", ""),
                "Tickers: " + ", ".join(t.get("ticker", "") for t in item.get("ticker_sentiment", [])[:5]) if item.get("ticker_sentiment") else "",
                "Topics: " + ", ".join(t.get("topic", "") for t in item.get("topics", [])[:5]) if item.get("topics") else "",
            ])).strip() or item.get("title", ""),
            source_id=item.get("url"),
            url=item.get("url"),
            raw=item,
        )


async def _fetch_finnhub(api_key: str) -> AsyncIterator[StandardizedNewsItem]:
    """Finnhub general and company news."""
    if not api_key:
        return
    url = "https://finnhub.io/api/v1/news"
    params = {"token": api_key}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params)
        if r.status_code != 200:
            return
        data = r.json()
    for item in (data if isinstance(data, list) else [])[:20]:
        yield StandardizedNewsItem(
            platform="Finnhub",
            source_name=item.get("source", "Finnhub"),
            source_topic=_topic_for_source("finnhub"),
            headline=item.get("headline", ""),
            publishing_date=_normalize_date(item.get("datetime")),
            metadata=item.get("summary", item.get("headline", "")),
            source_id=item.get("id") and str(item["id"]),
            url=item.get("url"),
            raw=item,
        )


async def _fetch_newsapi(api_key: str) -> AsyncIterator[StandardizedNewsItem]:
    """NewsAPI top business headlines / macro relevant business headlines."""
    if not api_key:
        return
    url = "https://newsapi.org/v2/top-headlines"
    params = {
        "apiKey": api_key,
        "category": "business",
        "language": "en",
        "pageSize": 20,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params)
        if r.status_code != 200:
            return
        data = r.json()
    for item in data.get("articles", [])[:20]:
        source = item.get("source", {}) or {}
        yield StandardizedNewsItem(
            platform=source.get("name", "NewsAPI"),
            source_name=f"NewsAPI:{source.get('name', 'business-headlines')}",
            source_topic=_topic_for_source(source.get("name", "newsapi")),
            headline=item.get("title", ""),
            publishing_date=_normalize_date(item.get("publishedAt")),
            metadata="\n".join(filter(None, [item.get("description", ""), item.get("content", "")])).strip() or item.get("title", ""),
            source_id=item.get("url"),
            url=item.get("url"),
            raw=item,
        )


async def _mock_sources() -> AsyncIterator[StandardizedNewsItem]:
    """Mock news when no API keys are set - for development."""
    mock = [
        ("Bloomberg", "US inflation rates higher than expected", "09/03/2026", "CPI data shows..."),
        ("Reuters", "Fed signals potential rate hold in March", "09/03/2026", "Federal Reserve..."),
        ("Reuters", "Oil prices rise on Middle East tensions", "08/03/2026", "Iran and Iraq..."),
        ("Reuters", "AI chip demand drives tech earnings", "08/03/2026", "Nvidia and AMD..."),
        ("Bloomberg", "Banking sector stress in regional lenders", "07/03/2026", "Regional banks..."),
    ]
    for platform, headline, pub_date, meta in mock:
        yield StandardizedNewsItem(
            platform=platform,
            source_name=platform,
            source_topic=_topic_for_source(platform),
            headline=headline,
            publishing_date=pub_date,
            metadata=meta,
            raw={},
        )


class NewsAdapterRegistry:
    """Registry of news adapters; each can be tied to a Kafka topic."""

    @staticmethod
    async def stream_all(settings) -> AsyncIterator[StandardizedNewsItem]:
        """Stream from all configured sources (or mock)."""
        has_any = bool(
            getattr(settings, "alpha_vantage_api_key", None)
            or getattr(settings, "finnhub_api_key", None)
            or getattr(settings, "news_api_key", None)
        )
        if has_any:
            if getattr(settings, "alpha_vantage_api_key", None):
                async for item in _fetch_alpha_vantage(settings.alpha_vantage_api_key):
                    yield item
            if getattr(settings, "finnhub_api_key", None):
                async for item in _fetch_finnhub(settings.finnhub_api_key):
                    yield item
            if getattr(settings, "news_api_key", None):
                async for item in _fetch_newsapi(settings.news_api_key):
                    yield item
        else:
            async for item in _mock_sources():
                yield item


async def get_standardized_news(settings) -> list[StandardizedNewsItem]:
    """Collect all standardized news items from configured adapters."""
    out: list[StandardizedNewsItem] = []
    async for item in NewsAdapterRegistry.stream_all(settings):
        out.append(item)
    return out
