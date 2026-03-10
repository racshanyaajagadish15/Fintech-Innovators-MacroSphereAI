"""Application configuration via environment variables."""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    groq_api_key: str = ""
    perigon_api_key: str = ""
    alpha_vantage_api_key: str = ""
    finnhub_api_key: str = ""
    news_api_key: str = ""
    fred_api_key: str = ""
    kafka_bootstrap_servers: str | None = None
    kafka_news_topic: str = "macrosphere-news-raw"
    database_url: str = "sqlite+aiosqlite:///./macrosphere.db"
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
