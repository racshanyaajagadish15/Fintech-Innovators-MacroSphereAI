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
    max_news: int = 20
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
    return {"status": "ok", "service": "macrosphere-ai"}


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
        return result
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
        return result.model_dump()
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg or "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@app.get("/api/map")
async def api_map():
    """Return knowledge graph data for map overlay (regions + heat/criticality)."""
    try:
        global _latest_pipeline_result
        if _latest_pipeline_result is None:
            _latest_pipeline_result = await run_pipeline(max_news=10, criticality_threshold=0.2, persist=False)
        result = _latest_pipeline_result
        return result.get("knowledge_graph_map", {"regions": {}, "themes_by_region": {}})
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg or "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception:
        return {"regions": {}, "themes_by_region": {}, "nodes": [], "edges": []}


@app.get("/api/state/latest")
async def api_latest_state():
    """Return the latest pipeline result cached in memory."""
    global _latest_pipeline_result
    if _latest_pipeline_result is None:
        _latest_pipeline_result = await run_pipeline(max_news=10, criticality_threshold=0.2, persist=False)
    return _latest_pipeline_result


@app.post("/api/theme/explain")
async def api_explain_theme(req: ExplainThemeRequest):
    """Run the investigation agent on a selected theme from the latest cached pipeline output."""
    global _latest_pipeline_result
    if _latest_pipeline_result is None:
        _latest_pipeline_result = await run_pipeline(max_news=10, criticality_threshold=req.criticality_threshold, persist=False)
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
    return {
        "theme": req.theme,
        "criticality": criticality,
        "investigation": result.model_dump(),
        "theme_detail": theme_details[idx].model_dump() if idx < len(theme_details) else {},
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
        rows = []
        runs = await ThemeRunRepository.latest(limit=max(limit, 5))
        seen: set[int] = set()
        for run in runs:
            if run.id in seen:
                continue
            seen.add(run.id)
        # Fallback query path: aggregate by recent known themes from stored theme runs.
        themes: list[str] = []
        for run in runs:
            themes.extend(run.themes_json or [])
        deduped = []
        for item in themes:
            if item not in deduped:
                deduped.append(item)
        for item in deduped[:limit]:
            rows.extend(await InsightRepository.list_by_theme(item, limit=1))
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
            for row in rows[:limit]
        ]
    }


@app.get("/api/history/simulations")
async def api_simulations(limit: int = 10):
    """Return recent simulator runs."""
    if not _DB_AVAILABLE:
        return {"items": []}
    from sqlalchemy import select
    from db.models import SimulatorRun, get_session_maker

    sm = get_session_maker()
    async with sm() as session:
        result = await session.execute(select(SimulatorRun).order_by(SimulatorRun.created_at.desc()).limit(limit))
        rows = result.scalars().all()
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
