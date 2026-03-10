"""MacroSphere AI - FastAPI application entrypoint."""
import os
import sys

# Ensure project root is on path when running as script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Any

from config import get_settings
from services.pipeline import run_pipeline
from agents.investigation import InvestigationAgent
from schemas.news import ExtractedEntitiesItem
from schemas.themes import ThemeOutput, ThemeWithCriticality

try:
    from db.models import init_db
    from db.repositories import ThemeRunRepository, InsightRepository, SimulatorRunRepository
    _DB_AVAILABLE = True
except ImportError:
    init_db = None  # sqlalchemy not installed; DB persistence disabled
    ThemeRunRepository = InsightRepository = SimulatorRunRepository = None
    _DB_AVAILABLE = False
from agents.simulator import SimulatorAgent
from schemas.simulator import SimulatorScenario, SimulatorEvent

_latest_pipeline_result: dict[str, Any] | None = None


def _clean_pipeline_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a minimal, frontend-ready pipeline result (no raw payloads)."""
    return {
        "extracted_count": raw.get("extracted_count", 0),
        "extracted_items": [
            {
                "headline": x.get("headline"),
                "summary": x.get("summary"),
                "event": x.get("event"),
                "entities": x.get("entities") or [],
                "platform": x.get("platform"),
                "publishing_date": x.get("publishing_date"),
                "source_id": x.get("source_id"),
                "regions": x.get("regions") or [],
                "asset_classes": x.get("asset_classes") or [],
                "sentiment_score": x.get("sentiment_score", 0.5),
                "source_name": x.get("source_name"),
                "source_topic": x.get("source_topic"),
                "key_facts": x.get("key_facts") or [],
            }
            for x in (raw.get("extracted_items") or [])
        ],
        "themes": raw.get("themes") or [],
        "criticality": raw.get("criticality") or [],
        "theme_details": [
            {
                "theme_id": t.get("theme_id"),
                "label": t.get("label"),
                "article_count": t.get("article_count", 0),
                "mention_count": t.get("mention_count", 0),
                "trend": t.get("trend", "stable"),
                "source_topics": t.get("source_topics") or [],
            }
            for t in (raw.get("theme_details") or [])
        ],
        "investigations": [
            {
                "theme": i.get("theme"),
                "narrative": i.get("narrative"),
                "signals": i.get("signals") or [],
                "involved_entities": i.get("involved_entities") or [],
                "involved_regions": i.get("involved_regions") or [],
                "market_impact_areas": i.get("market_impact_areas") or [],
                "metadata": i.get("metadata") or {},
                "trigger_reasons": (i.get("metadata") or {}).get("trigger_reasons", []),
                "related_events": (i.get("signals") or [])[:5],
            }
            for i in (raw.get("investigations") or [])
        ],
        "risk_analyses": [
            {
                "macro_theme": r.get("macro_theme"),
                "narrative": r.get("narrative"),
                "market_implications": [{"implication": m.get("implication"), "direction": m.get("direction"), "confidence": m.get("confidence")} for m in (r.get("market_implications") or [])],
            }
            for r in (raw.get("risk_analyses") or [])
        ],
        "knowledge_graph_map": raw.get("knowledge_graph_map") or {"regions": {}, "themes_by_region": {}, "nodes": [], "edges": []},
    }


def _clean_map_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Return map data only (regions, themes_by_region)."""
    return {
        "regions": raw.get("regions") or {},
        "themes_by_region": raw.get("themes_by_region") or {},
        "nodes": raw.get("nodes") or [],
        "edges": raw.get("edges") or [],
    }


app = FastAPI(
    title="MacroSphere AI",
    description="Multi-Agent Macroeconomics Tracker - news monitoring, theme detection, investigation, risk analysis, simulation",
    version="0.1.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Static UI (Simulator + Map)
_static = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static):
    app.mount("/static", StaticFiles(directory=_static), name="static")
    @app.get("/")
    async def index():
        from fastapi.responses import FileResponse
        return FileResponse(os.path.join(_static, "index.html"))


@app.on_event("startup")
async def startup():
    if init_db is not None:
        await init_db()


class PipelineRequest(BaseModel):
    max_news: int = 30
    criticality_threshold: float = 0.25
    persist: bool = True


class SimulatorRequest(BaseModel):
    scenario_name: str = ""
    events: list[dict[str, Any]] = []
    horizon_days: int = 30


class ExplainThemeRequest(BaseModel):
    theme: str
    criticality_threshold: float = 0.2


@app.get("/health")
async def health():
    """Health check; includes pipeline_ready when GROQ is configured."""
    settings = get_settings()
    pipeline_ready = bool(settings.groq_api_key and settings.groq_api_key.strip())
    return {
        "status": "ok",
        "service": "macrosphere-ai",
        "pipeline_ready": pipeline_ready,
    }


# Mock ticker data for scrolling strip (indices, FX, commodities, rates)
TICKER_ITEMS = [
    {"symbol": "SPX", "name": "S&P 500", "value": "5,847.23", "change": 0.24},
    {"symbol": "NDX", "name": "Nasdaq 100", "value": "21,092", "change": 0.41},
    {"symbol": "US2Y", "name": "2Y Treasury", "value": "4.62%", "change": -0.02},
    {"symbol": "US10Y", "name": "10Y Treasury", "value": "4.28%", "change": 0.01},
    {"symbol": "DXY", "name": "Dollar Index", "value": "104.82", "change": -0.15},
    {"symbol": "EURUSD", "name": "EUR/USD", "value": "1.0874", "change": 0.08},
    {"symbol": "BTC", "name": "Bitcoin", "value": "97,245", "change": 1.22},
    {"symbol": "WTI", "name": "WTI Crude", "value": "78.42", "change": -0.34},
    {"symbol": "XAU", "name": "Gold", "value": "2,341", "change": 0.56},
    {"symbol": "VIX", "name": "VIX", "value": "13.2", "change": -2.1},
]


@app.get("/api/ticker")
async def api_ticker():
    """Return ticker items for the scrolling strip (indices, rates, FX, commodities)."""
    import random
    # Slight random drift for live feel; in production replace with real feed
    out = []
    for item in list(TICKER_ITEMS):
        v = item["change"] + (random.random() - 0.5) * 0.2
        out.append({**item, "change": round(v, 2)})
    return {"items": out}


@app.post("/api/pipeline/run")
async def api_run_pipeline(req: PipelineRequest):
    """Run the full pipeline: news -> monitor -> themes -> investigate -> risk -> knowledge graph."""
    try:
        global _latest_pipeline_result
        result = await run_pipeline(
            max_news=req.max_news,
            criticality_threshold=req.criticality_threshold,
            persist=req.persist,
        )
        _latest_pipeline_result = result
        return _clean_pipeline_response(result)
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY not set. Add it to .env")
        if "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/simulator/run")
async def api_simulator_run(req: SimulatorRequest):
    """Run a what-if scenario with user-defined events (drag-and-drop style)."""
    try:
        events = [SimulatorEvent(**e) for e in req.events]
        scenario = SimulatorScenario(name=req.scenario_name, events=events, horizon_days=req.horizon_days)
        agent = SimulatorAgent()
        result = agent.run(scenario)
        if _DB_AVAILABLE:
            await SimulatorRunRepository.create(
                scenario_name=scenario.name or "Scenario",
                scenario_json=scenario.model_dump(),
                result_json=result.model_dump(),
            )
        out = result.model_dump()
        return {
            "scenario_name": out.get("scenario_name"),
            "outcomes": out.get("outcomes") or [],
            "market_impacts": out.get("market_impacts") or [],
            "confidence": out.get("confidence", 0),
            "llm_narrative": out.get("llm_narrative"),
            "monte_carlo_stats": out.get("monte_carlo_stats") or {},
        }
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg or "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@app.get("/api/map")
async def api_map():
    """Return knowledge graph data for map overlay (regions + heat/criticality). No auto-run; returns empty if no prior pipeline run."""
    global _latest_pipeline_result
    if _latest_pipeline_result is None:
        return _clean_map_response({})
    kg = _latest_pipeline_result.get("knowledge_graph_map") or {}
    return _clean_map_response(kg)


@app.get("/api/state/latest")
async def api_latest_state():
    """Return the latest pipeline result cached in memory (cleaned). No auto-run; returns empty state if no prior run."""
    global _latest_pipeline_result
    if _latest_pipeline_result is None:
        return {
            "extracted_count": 0,
            "extracted_items": [],
            "themes": [],
            "criticality": [],
            "theme_details": [],
            "investigations": [],
            "risk_analyses": [],
            "knowledge_graph_map": {"regions": {}, "themes_by_region": {}, "nodes": [], "edges": []},
        }
    return _clean_pipeline_response(_latest_pipeline_result)


@app.post("/api/theme/explain")
async def api_explain_theme(req: ExplainThemeRequest):
    """Run the investigation agent on a selected theme from the latest cached pipeline output."""
    global _latest_pipeline_result
    if _latest_pipeline_result is None:
        raise HTTPException(
            status_code=409,
            detail="No pipeline data yet. Run the pipeline first from the dashboard.",
        )
    cached = _latest_pipeline_result
    extracted = [ExtractedEntitiesItem(**item) for item in cached.get("extracted_items", [])]
    theme_details = [ThemeOutput(**item) for item in cached.get("theme_details", [])]
    theme_output = ThemeWithCriticality(
        themes=cached.get("themes", []),
        criticality=cached.get("criticality", []),
        theme_details=theme_details,
    )
    if req.theme not in theme_output.themes:
        raise HTTPException(status_code=404, detail=f"Theme not found in latest run: {req.theme}")
    idx = theme_output.themes.index(req.theme)
    criticality = theme_output.criticality[idx] if idx < len(theme_output.criticality) else 0.0
    agent = InvestigationAgent(criticality_threshold=req.criticality_threshold)
    result = agent.run(req.theme, criticality, extracted, theme_output)
    inv = result.model_dump()
    return {
        "theme": req.theme,
        "criticality": criticality,
        "investigation": {
            "theme": inv.get("theme"),
            "narrative": inv.get("narrative"),
            "signals": inv.get("signals") or [],
            "involved_entities": inv.get("involved_entities") or [],
            "involved_regions": inv.get("involved_regions") or [],
            "market_impact_areas": inv.get("market_impact_areas") or [],
            "trigger_reasons": (inv.get("metadata") or {}).get("trigger_reasons", []),
            "related_events": [s.get("description") for s in (inv.get("signals") or [])[:6]],
        },
        "theme_detail": (
            {"theme_id": t.get("theme_id"), "label": t.get("label"), "article_count": t.get("article_count", 0), "trend": t.get("trend", "stable")}
            if idx < len(theme_details) and (t := theme_details[idx].model_dump())
            else {}
        ),
    }


@app.get("/api/history/theme-runs")
async def api_theme_runs(limit: int = 10):
    """Return recent theme detection runs for institutional memory."""
    if not _DB_AVAILABLE:
        return {"items": []}
    rows = await ThemeRunRepository.latest(limit=limit)
    return {
        "items": [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "themes": row.themes_json or [],
                "criticality": row.criticality_json or [],
                "article_count": row.article_count,
            }
            for row in rows
        ]
    }


@app.get("/api/history/insights")
async def api_insights(theme: str | None = None, limit: int = 10):
    """Return stored investigations and risk outputs."""
    if not _DB_AVAILABLE:
        return {"items": []}
    if theme:
        rows = await InsightRepository.list_by_theme(theme, limit=limit)
    else:
        rows = await InsightRepository.list_recent(limit=limit)
    return {
        "items": [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "theme": row.theme,
                "criticality": row.criticality,
                "investigation": row.investigation_json or {},
                "risk": row.risk_json or {},
            }
            for row in rows
        ]
    }


@app.get("/api/history/simulations")
async def api_simulations(limit: int = 10):
    """Return recent simulator runs."""
    if not _DB_AVAILABLE:
        return {"items": []}
    rows = await SimulatorRunRepository.latest(limit=limit)
    return {
        "items": [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "scenario_name": row.scenario_name,
                "scenario": row.scenario_json or {},
                "result": row.result_json or {},
            }
            for row in rows
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
