# MacroSphere AI

<p align="center">
  <strong>A world-class AI-powered team of analysts that never sleep.</strong>
</p>

<p align="center">
  <em>MacroSphere AI by the Fintech Innovators</em>
</p>

---

## Table of contents

| Section | Description |
|--------|-------------|
| [Overview](#overview) | What MacroSphere AI does |
| [Features](#features) | Capabilities at a glance |
| [Tech stack](#tech-stack) | Technologies used |
| [Architecture](#architecture) | Pipeline and data flow |
| [How to run](#how-to-download-and-run) | Download, setup, and run |
| [Project structure](#project-structure) | Repository layout |
| [API reference](#api-reference) | Main endpoints |
| [Troubleshooting](#troubleshooting) | Common issues and fixes |

---

## Overview

MacroSphere AI is a **multi-agent platform** that:

- Monitors **global news** from multiple APIs (Alpha Vantage, Finnhub, NewsAPI)
- Detects **macro themes** and assigns criticality
- Investigates **high-criticality topics** with narratives and signals
- Simulates **market implications** and what-if scenarios
- Visualises impact on a **world map**

Everything is grounded in live (or mock) news and linked to source articles. Built for hackathon submission with **FastAPI**, **Groq AI**, **sentence-transformers**, and a single-page dashboard.

---

## Features

| Feature | Description |
|--------|-------------|
| **Multi-source news** | Fetches and combines articles from Alpha Vantage, Finnhub, and NewsAPI; mock fallback when keys are missing. |
| **Theme detection** | Clusters news via embeddings and assigns macro themes with criticality scores. |
| **Risk Pulse** | Highlighted risk narratives and market implications per theme. |
| **Investigation** | Deep-dive narratives and signals for high-criticality themes, grounded in many articles. |
| **Theme Lab** | Browse themes, trends, related articles, and risk analysis with explicit article linking. |
| **News tab** | View **all** collected articles from every API with search and theme filters. |
| **Scenario simulator** | Run what-if scenarios (rate hikes, supply shocks, etc.) with presets and “suggest from current themes”. |
| **World map** | Geographic overlay of regions and thematic impact (dark map, Leaflet). |
| **Pipeline controls** | Configurable news limit, criticality threshold, and persistence. |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI, Python 3.10+ |
| **AI / LLM** | Groq (via LangChain), sentence-transformers |
| **Theme detection** | scikit-learn clustering, embeddings |
| **Storage** | SQLite (async aiosqlite), SQLAlchemy |
| **Frontend** | Vanilla JS, CSS, Leaflet.js |
| **News APIs** | Alpha Vantage, Finnhub, NewsAPI |

---

## Architecture

```
News APIs (Alpha Vantage, Finnhub, NewsAPI)
         ↓
   Standardized news (interleaved)
         ↓
   News Monitoring Agent (summarize + extract entities, parallelised)
         ↓
   Theme Detection Agent (embeddings + clustering + criticality)
         ↓
   Investigation Agent (high-criticality narratives + signals)
         ↓
   Risk Analysis Engine (market implications per theme)
         ↓
   Connection Agent (knowledge graph, map regions)
         ↓
   Frontend: Overview | Theme Lab | News | Simulation | World Map
```

| Component | Role |
|-----------|------|
| **Pipeline** | Runs on demand. Fetches from all APIs, processes a capped set for themes/LLM, returns **all** collected articles so the News tab shows every article. |
| **Simulator** | User-defined or preset events → scenario outcomes with confidence and market impacts. |

---

## How to download and run

### Prerequisites

| Requirement | Details |
|-------------|---------|
| **Python** | 3.10 or higher |
| **Git** | For cloning (or use “Download ZIP”) |

### Setup steps

#### 1. Clone the repository

```bash
git clone https://github.com/Fintech-Innovators/MacroSphereAI.git
cd MacroSphereAI
```

<sub>*If you have a zip, extract it and `cd` into the project folder.*</sub>

#### 2. Create a virtual environment

| OS | Command |
|----|---------|
| **macOS / Linux** | `python3 -m venv .venv` then `source .venv/bin/activate` |
| **Windows (CMD)** | `python -m venv .venv` then `.venv\Scripts\activate.bat` |
| **Windows (PowerShell)** | `python -m venv .venv` then `.venv\Scripts\Activate.ps1` |

```bash
# Example (macOS / Linux)
python3 -m venv .venv
source .venv/bin/activate
```

#### 3. Install dependencies

```bash
pip install -r requirements.txt
```

<sub>*First run may take a few minutes (sentence-transformers and ML deps).*</sub>


#### 4. Run the application

From the project root (with the virtual environment activated):

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

| Link | Purpose |
|------|---------|
| [http://localhost:8000](http://localhost:8000) | **Web app** |
| [http://localhost:8000/docs](http://localhost:8000/docs) | API docs (Swagger) |
| [http://localhost:8000/health](http://localhost:8000/health) | Health check |

#### 5. Use the app

| Step | Action |
|------|--------|
| 1 | On the landing page, click **“Go to dashboard”**. |
| 2 | In **Overview**, click **“Run pipeline”** (set news limit & threshold if you like). Wait for the run to finish. |
| 3 | Browse **Overview** (themes, alerts, Risk Pulse), **Theme Lab**, **News**, **Simulation**, and **World Map**. |

---

## Project structure

```
MacroSphereAI/
├── main.py                 # FastAPI app, routes, static files
├── config.py               # Settings (env vars)
├── requirements.txt        # Python dependencies
├── .env                     # Your keys (create in setup; do not commit)
├── ingestion/
│   └── adapters.py          # News API adapters (Alpha Vantage, Finnhub, NewsAPI, mock)
├── agents/
│   ├── news_monitoring.py   # Summarise + extract entities
│   ├── theme_detection.py   # Clustering + criticality
│   ├── investigation.py    # Narratives + signals
│   ├── risk.py             # Market implications
│   ├── connection.py       # Knowledge graph + map
│   ├── simulator.py        # Scenario simulation
│   └── llm.py              # Groq LLM wrapper
├── services/
│   └── pipeline.py         # Pipeline orchestration
├── schemas/                 # Pydantic models
├── db/                      # SQLAlchemy models and repositories
└── static/
    ├── index.html           # Single-page app
    ├── app.js               # Dashboard logic
    ├── app.css              # Styles
    └── ticker.js            # Ticker strip
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/pipeline/run` | Run full pipeline. Body: `{ "max_news": 100, "criticality_threshold": 0.25, "persist": true }` |
| `GET` | `/api/state/latest` | Latest pipeline result (themes, articles, risk, map) |
| `GET` | `/api/map` | Map data (regions, themes by region) |
| `POST` | `/api/theme/explain` | Explain a theme (investigation for selected theme) |
| `POST` | `/api/simulator/run` | Run scenario. Body: `{ "scenario_name": "...", "events": [...], "horizon_days": 30 }` |
| `GET` | `/health` | Health and `pipeline_ready` (Groq configured) |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **“Pipeline requires GROQ_API_KEY”** | Add `GROQ_API_KEY` to `.env` and restart the server. |
| **No news / empty News tab** | Add at least one of `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, or `NEWS_API_KEY` for live articles; otherwise mock news is used. |
| **Port 8000 in use** | Use another port: `uvicorn main:app --reload --host 0.0.0.0 --port 8080`, then open `http://localhost:8080`. |
| **Slow first pipeline run** | First run downloads the embedding model; later runs are faster. |

---

---

<p align="center">
  <em>Built by the Fintech Innovators for NTU NPC Fintech Innovators' Hackathon submission.</em>
</p>
