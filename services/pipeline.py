"""Orchestration pipeline: news -> monitor -> themes -> investigate (high criticality) -> risk -> connection."""
from __future__ import annotations

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
    max_news: int = 20,
    criticality_threshold: float = 0.25,
    persist: bool = True,
):
    """Run full pipeline: fetch news -> standardize -> summarize+extract -> theme detection -> investigate high-criticality -> risk -> knowledge graph."""
    settings = get_settings()
    topic = settings.kafka_news_topic

    # 1. Fetch and standardize news (optionally publish to stream)
    raw_items = await get_standardized_news(settings)
    items = raw_items[:max_news]
    for it in items:
        await publish_standardized(topic, it)

    # 2. News Monitoring: summarize + extract entities
    monitor = NewsMonitoringAgent()
    extracted: list[ExtractedEntitiesItem] = []
    for it in items:
        try:
            ex = monitor.process(it)
            extracted.append(ex)
        except Exception as e:
            extracted.append(
                ExtractedEntitiesItem(event=it.headline, entities=[], headline=it.headline, platform=it.platform, publishing_date=it.publishing_date, summary=it.metadata[:500])
            )

    # 3. Theme detection
    theme_agent = ThemeDetectionAgent()
    theme_output = theme_agent.run(extracted)
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
    investigations = []
    risk_outputs = []

    for i, (theme, crit) in enumerate(zip(theme_output.themes, theme_output.criticality)):
        if crit >= criticality_threshold:
            inv = inv_agent.run(theme, crit, extracted, theme_output)
            investigations.append(inv)
            conn_agent.ingest_investigation(inv)
            risk = risk_engine.run(theme, inv.narrative, context="; ".join(inv.market_impact_areas))
            risk_outputs.append(risk)
            if persist and _db_available:
                await InsightRepository.create(
                    theme=theme,
                    criticality=crit,
                    investigation_json=inv.model_dump(),
                    risk_json=risk.model_dump(),
                )

    map_data = conn_agent.to_map_data()
    return {
        "extracted_count": len(extracted),
        "themes": theme_output.themes,
        "criticality": theme_output.criticality,
        "theme_details": [t.model_dump() for t in theme_output.theme_details],
        "investigations": [i.model_dump() for i in investigations],
        "risk_analyses": [r.model_dump() for r in risk_outputs],
        "knowledge_graph_map": map_data,
    }
