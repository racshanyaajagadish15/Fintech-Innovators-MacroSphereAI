"""SQLAlchemy models for themes, insights, investigations, simulator runs."""
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from config import get_settings

Base = declarative_base()


class ThemeRun(Base):
    """One run of theme detection (batch of news -> themes with criticality)."""
    __tablename__ = "theme_runs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    themes_json = Column(JSON, nullable=True)
    criticality_json = Column(JSON, nullable=True)
    article_count = Column(Integer, default=0)


class StoredInsight(Base):
    """Stored investigation + risk output for a theme."""
    __tablename__ = "insights"
    id = Column(Integer, primary_key=True, autoincrement=True)
    theme_run_id = Column(Integer, ForeignKey("theme_runs.id"), nullable=True)
    theme = Column(String(512), nullable=False)
    criticality = Column(Float, default=0.0)
    investigation_json = Column(JSON, nullable=True)
    risk_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SimulatorRun(Base):
    """One simulator scenario run."""
    __tablename__ = "simulator_runs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    scenario_name = Column(String(256), default="")
    scenario_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_engine():
    settings = get_settings()
    return create_async_engine(settings.database_url, echo=False)


def get_session_maker(engine=None):
    engine = engine or get_engine()
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    import logging
    logger = logging.getLogger(__name__)
    try:
        engine = get_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except ValueError as e:
        if "greenlet" in str(e).lower():
            logger.warning("Database init skipped: greenlet is required for async SQLAlchemy. Install with: pip install greenlet")
        else:
            raise
    except Exception as e:
        logger.warning("Database init failed: %s", e)
