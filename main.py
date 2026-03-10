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

try:
    from db.models import init_db
except ImportError:
    init_db = None  # sqlalchemy not installed; DB persistence disabled
from agents.simulator import SimulatorAgent
from schemas.simulator import SimulatorScenario, SimulatorEvent

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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "macrosphere-ai"}


@app.post("/api/pipeline/run")
async def api_run_pipeline(req: PipelineRequest):
    """Run the full pipeline: news -> monitor -> themes -> investigate -> risk -> knowledge graph."""
    try:
        result = await run_pipeline(
            max_news=req.max_news,
            criticality_threshold=req.criticality_threshold,
            persist=req.persist,
        )
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
        return result.model_dump()
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg or "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@app.get("/api/map")
async def api_map():
    """Return knowledge graph data for map overlay (regions + heat/criticality)."""
    # Run a lightweight pipeline to get current map state, or could be stored in DB
    try:
        result = await run_pipeline(max_news=10, criticality_threshold=0.2, persist=False)
        return result.get("knowledge_graph_map", {"regions": {}, "themes_by_region": {}})
    except ValueError as e:
        msg = str(e)
        if "GROQ_API_KEY" in msg or "langchain-groq" in msg or "langchain-core" in msg or "LangChain" in msg or "networkx" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception:
        return {"regions": {}, "themes_by_region": {}, "nodes": [], "edges": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
