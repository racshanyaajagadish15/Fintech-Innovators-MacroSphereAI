# MacroSphere AI – Multi-Agent Macroeconomics Tracker

Multi-agent platform that monitors global news, detects macro themes, investigates high-criticality topics, and simulates market implications. Built with **Groq AI** and **LangChain**.

## Three pillars

1. **Specialised agents** – Continuous monitoring and interpretation of global information  
2. **Autonomous investigation** – Anomaly/trend detection and macro narrative building  
3. **Real-time simulation** – Macro relationships updated with incoming news and user what-ifs  

## Architecture

```
News APIs (Alpha Vantage, Finnhub, mock) → Kafka/stream (or in-memory)
    → News Monitoring Agent (summarize + extract entities)
    → Theme Detection Agent (sentence-transformers clustering + criticality)
    → Investigation Agent (high-criticality deep-dive)
    → Connection Agent (knowledge graph, map overlay)
    → Risk Analysis Engine (market implications)
Simulator: user-defined events → LLM + Monte Carlo → scenario outcomes
```

## Setup

### 1. Environment

```bash
cp .env.example .env
# Set your Groq API key (required for agents)
# Optional: add news API keys (Alpha Vantage, Finnhub) or use mock data
```

In `.env`:

```env
GROQ_API_KEY=your-groq-api-key
# Optional: ALPHA_VANTAGE_API_KEY=... FINNHUB_API_KEY=...
DATABASE_URL=sqlite+aiosqlite:///./macrosphere.db
```

### 2. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 3. Run the API

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

- **API docs:** http://localhost:8000/docs  
- **Health:** http://localhost:8000/health  

## API overview

| Endpoint | Description |
|----------|-------------|
| `POST /api/pipeline/run` | Run full pipeline (news → themes → investigation → risk → knowledge graph). Body: `{ "max_news": 20, "criticality_threshold": 0.25, "persist": true }` |
| `POST /api/simulator/run` | Run a what-if scenario. Body: `{ "scenario_name": "...", "events": [{ "event_type": "rate_hike", "description": "...", "magnitude": 1.0 }], "horizon_days": 30 }` |
| `GET /api/map` | Get knowledge graph data for map overlay (regions + criticality) |

## Agents

- **News Monitoring** – Fetches from configured APIs, normalizes to standard JSON, summarizes with Groq, extracts entities/events.  
- **Theme Detection** – Aggregates extracted items, clusters via sentence-transformers (`all-MiniLM-L6-v2`), assigns criticality (article share + optional sentiment).  
- **Investigation** – Triggered for themes above `criticality_threshold`; builds narrative and signals (geopolitical, commodity, rates, etc.).  
- **Connection** – Knowledge graph (themes, entities, regions, signals); exports structure for a world map heat overlay.  
- **Risk Analysis** – LLM-generated market implications per theme (rates, bonds, FX, equities).  
- **Simulator** – User-defined events; LLM scenario narrative + optional Monte Carlo stats.  

## Data and storage

- **RDB (SQLite by default):** theme runs, stored insights (investigation + risk), simulator runs.  
- **Stream:** In-memory queue per topic when Kafka is not configured; each news source can be mapped to a topic.  

## Simulator (what-if)

Send a scenario with a list of events, e.g.:

- `rate_hike`, `supply_shock`, `war_escalation`, `banking_stress`  
- Each event can have `event_type`, `description`, `region`, `magnitude`, `params`.  

The simulator returns outcomes, market impacts, confidence, and an LLM narrative; Monte Carlo stats are included when applicable.

## Adding more news sources

Implement an async generator in `ingestion/adapters.py` that yields `StandardizedNewsItem`, then register it in `NewsAdapterRegistry.stream_all()` (and optionally publish to a Kafka topic). Suggested APIs: Perigon, Dow Jones, LexisNexis (with appropriate keys and rate limits).

## License

MIT.
