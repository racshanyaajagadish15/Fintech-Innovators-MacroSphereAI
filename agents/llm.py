"""LLM client wrapper using the direct Groq SDK."""
from __future__ import annotations

from dataclasses import dataclass

try:
    from groq import Groq
    _GROQ_AVAILABLE = True
except ImportError:
    Groq = None
    _GROQ_AVAILABLE = False

from config import get_settings


@dataclass
class LLMResponse:
    content: str


class GroqChatClient:
    def __init__(self, model: str, temperature: float, api_key: str):
        self.model = model
        self.temperature = temperature
        self.client = Groq(api_key=api_key)

    def invoke(self, messages: list[dict[str, str]]) -> LLMResponse:
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        return LLMResponse(content=content)


def get_llm(
    model: str = "llama-3.1-8b-instant",
    temperature: float = 0.2,
):
    """Return Groq chat client. Needs GROQ_API_KEY and the groq package."""
    if not _GROQ_AVAILABLE:
        raise ValueError("Groq SDK is not installed. Install it with: pip install groq")
    settings = get_settings()
    if not settings.groq_api_key:
        raise ValueError("GROQ_API_KEY is required. Set it in .env")
    return GroqChatClient(
        model=model,
        temperature=temperature,
        api_key=settings.groq_api_key,
    )
