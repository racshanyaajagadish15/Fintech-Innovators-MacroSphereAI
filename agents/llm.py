"""LLM via LangChain: Groq as the provider. Shared by all agents."""
try:
    from langchain_groq import ChatGroq  # LangChain integration package for Groq
    from langchain_core.language_models import BaseChatModel
    _GROQ_INTEGRATION_AVAILABLE = True
except ImportError:
    ChatGroq = None
    BaseChatModel = None
    _GROQ_INTEGRATION_AVAILABLE = False

from config import get_settings


def get_llm(
    model: str = "llama-3.1-8b-instant",
    temperature: float = 0.2,
):
    """Return LLM instance: LangChain framework, Groq provider. Needs GROQ_API_KEY and the LangChain–Groq integration package."""
    if not _GROQ_INTEGRATION_AVAILABLE:
        raise ValueError(
            "LangChain integration for Groq is not installed. Install it with: pip install langchain-groq"
        )
    settings = get_settings()
    if not settings.groq_api_key:
        raise ValueError("GROQ_API_KEY is required. Set it in .env")
    return ChatGroq(
        model=model,
        temperature=temperature,
        api_key=settings.groq_api_key,
    )
