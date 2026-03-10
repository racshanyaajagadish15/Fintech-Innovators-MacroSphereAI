"""News API adapters: fetch from external APIs and normalize to StandardizedNewsItem."""
from datetime import datetime
from typing import AsyncIterator
import logging
import httpx
from schemas.news import StandardizedNewsItem

logger = logging.getLogger(__name__)


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
    """Alpha Vantage News & Sentiment API. Free tier may return only a few articles per request."""
    if not api_key:
        return
    url = "https://www.alphavantage.co/query"
    params = {"function": "NEWS_SENTIMENT", "apikey": api_key, "limit": 200}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                logger.warning("Alpha Vantage returned status %s", r.status_code)
                return
            data = r.json()
        feed = data.get("feed", [])
        if not feed and data.get("Note"):
            logger.info("Alpha Vantage rate limit or quota: %s", data.get("Note", "")[:80])
    except Exception as e:
        logger.warning("Alpha Vantage fetch failed: %s", e)
        return
    for item in feed[:200]:
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
    for item in (data if isinstance(data, list) else [])[:200]:
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
        "pageSize": 100,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params)
        if r.status_code != 200:
            return
        data = r.json()
    for item in data.get("articles", [])[:100]:
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
    """Mock news when no API keys are set - macro-oriented headlines for better theme detection."""
    mock = [
        ("Bloomberg", "US inflation rates higher than expected in February", "09/03/2026", "CPI data shows persistent price pressures."),
        ("Reuters", "Fed signals potential rate hold in March meeting", "09/03/2026", "Federal Reserve officials indicate patience on cuts."),
        ("Reuters", "Oil prices rise on Middle East supply concerns", "08/03/2026", "Geopolitical tensions weigh on energy markets."),
        ("Reuters", "European Central Bank keeps rates unchanged", "08/03/2026", "ECB holds policy steady amid growth concerns."),
        ("Bloomberg", "Banking sector stress in regional lenders", "08/03/2026", "Regional banks face funding pressures."),
        ("Reuters", "Global supply chain disruptions hit manufacturing", "07/03/2026", "Shipping and logistics delays persist."),
        ("Reuters", "Labor market cools as job openings decline", "07/03/2026", "Wage growth moderates in latest report."),
        ("Bloomberg", "Fiscal policy expansion in major economies", "06/03/2026", "Government spending supports growth."),
        ("Reuters", "Geopolitical risk premium in commodity markets", "06/03/2026", "Oil and gold rally on uncertainty."),
        ("Reuters", "Interest rate expectations shift after payrolls", "05/03/2026", "Markets price fewer cuts this year."),
        ("Bloomberg", "Energy prices volatility amid weather and conflict", "05/03/2026", "Natural gas and crude swing."),
        ("Reuters", "Inflation expectations edge higher in survey", "04/03/2026", "Consumers see prices rising."),
        ("Reuters", "Banking regulation tightening after stress tests", "04/03/2026", "Regulators flag capital requirements."),
        ("Bloomberg", "Trade tensions and tariffs in focus", "03/03/2026", "Cross-border trade policy in spotlight."),
        ("Reuters", "Housing market slowdown as mortgage rates stay high", "03/03/2026", "Affordability weighs on demand."),
        ("Reuters", "Currency markets react to central bank divergence", "02/03/2026", "Dollar strength on rate differentials."),
        ("Bloomberg", "Commodity supercycle debate heats up", "02/03/2026", "Copper, lithium in focus for energy transition."),
        ("Reuters", "Sovereign debt sustainability in emerging markets", "01/03/2026", "Borrowing costs rise for EM issuers."),
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
    """Collect from ALL configured APIs and interleave so the pipeline gets a mix from every source."""
    has_any = bool(
        getattr(settings, "alpha_vantage_api_key", None)
        or getattr(settings, "finnhub_api_key", None)
        or getattr(settings, "news_api_key", None)
    )
    if not has_any:
        out: list[StandardizedNewsItem] = []
        async for item in _mock_sources():
            out.append(item)
        return out

    # Fetch from each configured source into separate lists (one failing API doesn't block others)
    sources: list[list[StandardizedNewsItem]] = []
    if getattr(settings, "alpha_vantage_api_key", None):
        try:
            av_list = []
            async for item in _fetch_alpha_vantage(settings.alpha_vantage_api_key):
                av_list.append(item)
            if av_list:
                sources.append(av_list)
                logger.info("Alpha Vantage: %d articles", len(av_list))
        except Exception as e:
            logger.warning("Alpha Vantage skipped: %s", e)
    if getattr(settings, "finnhub_api_key", None):
        try:
            fh_list = []
            async for item in _fetch_finnhub(settings.finnhub_api_key):
                fh_list.append(item)
            if fh_list:
                sources.append(fh_list)
                logger.info("Finnhub: %d articles", len(fh_list))
        except Exception as e:
            logger.warning("Finnhub skipped: %s", e)
    if getattr(settings, "news_api_key", None):
        try:
            na_list = []
            async for item in _fetch_newsapi(settings.news_api_key):
                na_list.append(item)
            if na_list:
                sources.append(na_list)
                logger.info("NewsAPI: %d articles", len(na_list))
        except Exception as e:
            logger.warning("NewsAPI skipped: %s", e)

    if not sources:
        return []

    # Interleave: take one from each source in turn so we get a mix from all APIs
    out = []
    idx = 0
    while True:
        added = 0
        for src_list in sources:
            if idx < len(src_list):
                out.append(src_list[idx])
                added += 1
        if added == 0:
            break
        idx += 1
    return out
