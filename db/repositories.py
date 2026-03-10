"""Repositories for theme runs and insights."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ThemeRun, StoredInsight, SimulatorRun, get_engine, get_session_maker


class ThemeRunRepository:
    @staticmethod
    async def create(themes: list, criticality: list, article_count: int = 0) -> ThemeRun:
        sm = get_session_maker()
        async with sm() as session:
            run = ThemeRun(themes_json=themes, criticality_json=criticality or [], article_count=article_count)
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return run

    @staticmethod
    async def latest(limit: int = 10):
        sm = get_session_maker()
        async with sm() as session:
            r = await session.execute(select(ThemeRun).order_by(ThemeRun.created_at.desc()).limit(limit))
            return r.scalars().all()


class InsightRepository:
    @staticmethod
    async def create(theme: str, criticality: float, investigation_json: dict, risk_json: dict, theme_run_id: int | None = None):
        sm = get_session_maker()
        async with sm() as session:
            row = StoredInsight(
                theme=theme,
                criticality=criticality,
                investigation_json=investigation_json,
                risk_json=risk_json,
                theme_run_id=theme_run_id,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    @staticmethod
    async def list_by_theme(theme: str, limit: int = 5):
        sm = get_session_maker()
        async with sm() as session:
            r = await session.execute(
                select(StoredInsight).where(StoredInsight.theme == theme).order_by(StoredInsight.created_at.desc()).limit(limit)
            )
            return r.scalars().all()


class SimulatorRunRepository:
    @staticmethod
    async def create(scenario_name: str, scenario_json: dict, result_json: dict):
        sm = get_session_maker()
        async with sm() as session:
            row = SimulatorRun(scenario_name=scenario_name, scenario_json=scenario_json, result_json=result_json)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row
