"""Orchestration pipeline: news -> monitor -> themes -> investigate (high criticality) -> risk -> connection."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from ingestion.adapters import get_standardized_news
from ingestion.stream import publish_standardized
from agents.news_monitoring import NewsMonitoringAgent
from agents.theme_detection import ThemeDetectionAgent
from agents.investigation import InvestigationAgent
from agents.connection import ConnectionAgent
from agents.risk import RiskAnalysisEngine
from config import get_settings
from schemas.news import StandardizedNewsItem, ExtractedEntitiesItem
from schemas.themes import ThemeWithCriticality

try:
    from db.repositories import ThemeRunRepository, InsightRepository
    _db_available = True
except ImportError:
    ThemeRunRepository = InsightRepository = None
    _db_available = False


async def run_pipeline(
    max_news: int = 100,
    criticality_threshold: float = 0.25,
    persist: bool = True,
):
    """Run full pipeline: fetch news -> standardize -> summarize+extract -> theme detection -> investigate high-criticality -> risk -> knowledge graph."""
    get_settings()

    # 1. Fetch and standardize news from ALL configured APIs (no truncation until cap)
    raw_items = await get_standardized_news(get_settings())
    cap = max(1, min(max_news, 150))  # use up to max_news, hard cap 150 for cost/speed
    items = raw_items[:cap]
    for it in items:
        await publish_standardized(it.source_topic or it.platform or "macrosphere-news-raw", it)

    # 2. News Monitoring: summarize + extract entities (parallel, one LLM call per article)
    monitor = NewsMonitoringAgent()
    loop = asyncio.get_event_loop()
    fallback = lambda it: ExtractedEntitiesItem(
        event=it.headline,
        entities=[],
        regions=[],
        asset_classes=[],
        sentiment_score=0.5,
        headline=it.headline,
        platform=it.platform,
        source_name=it.source_name,
        source_topic=it.source_topic,
        publishing_date=it.publishing_date,
        summary=it.metadata[:500],
        key_facts=[],
        source_id=it.source_id,
        url=getattr(it, "url", None),
    )

    def process_one(article: StandardizedNewsItem) -> ExtractedEntitiesItem:
        try:
            return monitor.process(article)
        except Exception:
            return fallback(article)

    with ThreadPoolExecutor(max_workers=10) as executor:
        fs = [loop.run_in_executor(executor, process_one, it) for it in items]
        results = await asyncio.gather(*fs, return_exceptions=True)
    extracted = [
        r if isinstance(r, ExtractedEntitiesItem) else fallback(items[i])
        for i, r in enumerate(results)
    ]

    # 3. Theme detection
    theme_agent = ThemeDetectionAgent()
    theme_output = theme_agent.run(extracted, sentiment_weights=[item.sentiment_score for item in extracted])
    if persist and _db_available and theme_output.themes:
        await ThemeRunRepository.create(
            themes=theme_output.themes,
            criticality=theme_output.criticality,
            article_count=len(extracted),
        )

    # 4. Investigation for high-criticality themes
    inv_agent = InvestigationAgent(criticality_threshold=criticality_threshold)
    conn_agent = ConnectionAgent()
    risk_engine = RiskAnalysisEngine()

    conn_agent.ingest_themes(theme_output)
    all_themes_crit = list(zip(theme_output.themes, theme_output.criticality))
    high_crit = [(t, c) for t, c in all_themes_crit if c >= criticality_threshold]
    if not high_crit and all_themes_crit:
        all_sorted = sorted(all_themes_crit, key=lambda x: -x[1])
        high_crit = all_sorted[: min(5, len(all_sorted))]

    def run_inv_and_risk(theme: str, crit: float):
        inv = inv_agent.run(theme, crit, extracted, theme_output)
        risk = risk_engine.run(theme, inv.narrative, context="; ".join(inv.market_impact_areas))
        return theme, crit, inv, risk

    investigations = []
    risk_outputs = []
    themes_done = set()
    if high_crit:
        with ThreadPoolExecutor(max_workers=6) as executor:
            inv_fs = [
                loop.run_in_executor(executor, run_inv_and_risk, theme, crit)
                for theme, crit in high_crit
            ]
            inv_results = await asyncio.gather(*inv_fs, return_exceptions=True)
        for r in inv_results:
            if isinstance(r, Exception):
                continue
            theme, crit, inv, risk = r
            themes_done.add(theme)
            investigations.append(inv)
            risk_outputs.append(risk)
            conn_agent.ingest_investigation(inv)
            if persist and _db_available:
                await InsightRepository.create(
                    theme=theme,
                    criticality=crit,
                    investigation_json=inv.model_dump(),
                    risk_json=risk.model_dump(),
                )

    extra_themes = [t for t in theme_output.themes if t not in themes_done]
    if extra_themes:
        def run_risk_only(theme: str):
            try:
                return risk_engine.run(theme, "", "")
            except Exception:
                return None
        with ThreadPoolExecutor(max_workers=6) as executor:
            extra_fs = [loop.run_in_executor(executor, run_risk_only, t) for t in extra_themes]
            extra_risks = await asyncio.gather(*extra_fs, return_exceptions=True)
        for r in extra_risks:
            if r is not None and not isinstance(r, Exception):
                risk_outputs.append(r)

    map_data = conn_agent.to_map_data()
    if not map_data.get("regions") and extracted:
        region_counts: dict[str, int] = {}
        for it in extracted:
            for r in it.regions or []:
                if r and str(r).strip():
                    region_counts[str(r).strip()] = region_counts.get(str(r).strip(), 0) + 1
        if region_counts:
            total = sum(region_counts.values()) or 1
            map_data["regions"] = {r: count / total for r, count in region_counts.items()}
            map_data["themes_by_region"] = {r: theme_output.themes[:3] for r in map_data["regions"]}
    return {
        "standardized_news": [i.model_dump() for i in raw_items],
        "extracted_items": [i.model_dump() for i in extracted],
        "extracted_count": len(extracted),
        "themes": theme_output.themes,
        "criticality": theme_output.criticality,
        "theme_details": [t.model_dump() for t in theme_output.theme_details],
        "investigations": [i.model_dump() for i in investigations],
        "risk_analyses": [r.model_dump() for r in risk_outputs],
        "knowledge_graph_map": map_data,
    }
