import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("scalable-ai-api")


def env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


@dataclass(frozen=True)
class Settings:
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_publishable_key: str = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    allowed_origin: str = os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")
    requests_per_minute: int = env_int("AI_REQUESTS_PER_MINUTE", 10)
    daily_token_limit: int = env_int("AI_DAILY_TOKEN_LIMIT", 50_000)
    monthly_spending_ceiling_microusd: int = env_int("AI_MONTHLY_SPENDING_CEILING_MICROUSD", 25_000_000)
    max_output_tokens: int = env_int("AI_MAX_OUTPUT_TOKENS", 1_024)
    provider_timeout_seconds: int = env_int("AI_PROVIDER_TIMEOUT_SECONDS", 30)
    provider_retries: int = env_int("AI_PROVIDER_RETRIES", 1)
    input_price_microusd_per_million: int = env_int("AI_INPUT_PRICE_MICROUSD_PER_MILLION", 1_000_000)
    output_price_microusd_per_million: int = env_int("AI_OUTPUT_PRICE_MICROUSD_PER_MILLION", 3_000_000)


settings = Settings()


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    max_output_tokens: int = Field(default=512, ge=1, le=2_048)


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    id: str
    provider: str
    model: str
    content: str
    usage: Usage


class AuthenticatedUser(BaseModel):
    id: uuid.UUID


class ProviderResult(BaseModel):
    provider: str
    model: str
    content: str
    input_tokens: int
    output_tokens: int


app = FastAPI(title="Scalable AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.allowed_origin.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


def require_server_configuration() -> None:
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_PUBLISHABLE_KEY", settings.supabase_publishable_key),
            ("SUPABASE_SERVICE_ROLE_KEY", settings.supabase_service_role_key),
        )
        if not value
    ]
    if missing:
        raise HTTPException(status_code=503, detail={"code": "server_not_configured", "missing": missing})


async def authenticated_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    require_server_configuration()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "authentication_required"})
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.supabase_publishable_key, "Authorization": authorization},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail={"code": "invalid_session"})
    return AuthenticatedUser(id=response.json()["id"])


def estimate_tokens(payload: ChatRequest) -> int:
    input_upper_bound = sum(len(message.content) for message in payload.messages)
    return input_upper_bound + min(payload.max_output_tokens, settings.max_output_tokens)


def estimate_cost_microusd(payload: ChatRequest) -> int:
    input_upper_bound = sum(len(message.content) for message in payload.messages)
    output_upper_bound = min(payload.max_output_tokens, settings.max_output_tokens)
    return (
        input_upper_bound * settings.input_price_microusd_per_million
        + output_upper_bound * settings.output_price_microusd_per_million
    ) // 1_000_000


async def quota_rpc(function: str, body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10) as client:
        return await client.post(
            f"{settings.supabase_url}/rest/v1/rpc/{function}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )


async def reserve_quota(user_id: uuid.UUID, payload: ChatRequest) -> uuid.UUID:
    response = await quota_rpc(
        "reserve_ai_usage",
        {
            "p_user_id": str(user_id),
            "p_estimated_tokens": estimate_tokens(payload),
            "p_estimated_cost_microusd": estimate_cost_microusd(payload),
            "p_requests_per_minute": settings.requests_per_minute,
            "p_daily_token_limit": settings.daily_token_limit,
            "p_monthly_cost_limit_microusd": settings.monthly_spending_ceiling_microusd,
        },
    )
    if response.status_code == 200:
        return uuid.UUID(response.json())
    message = response.json().get("message", "quota_check_failed")
    status = 429 if message in {"rate_limit_exceeded", "daily_token_quota_exceeded"} else 402 if message == "monthly_spending_ceiling_exceeded" else 503
    raise HTTPException(status_code=status, detail={"code": message})


async def finalize_quota(reservation_id: uuid.UUID, status: str, result: ProviderResult | None = None) -> None:
    actual_tokens = result.input_tokens + result.output_tokens if result else 0
    actual_cost = 0
    if result:
        actual_cost = (
            result.input_tokens * settings.input_price_microusd_per_million
            + result.output_tokens * settings.output_price_microusd_per_million
        ) // 1_000_000
    response = await quota_rpc(
        "finalize_ai_usage",
        {
            "p_reservation_id": str(reservation_id),
            "p_status": status,
            "p_actual_tokens": actual_tokens,
            "p_actual_cost_microusd": actual_cost,
            "p_provider": result.provider if result else None,
        },
    )
    if response.status_code != 204 and response.status_code != 200:
        logger.error("quota_finalization_failed reservation_id=%s status=%s", reservation_id, response.status_code)


async def request_with_retry(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(settings.provider_retries + 1):
        try:
            response = await client.request(method, url, **kwargs)
            if response.status_code not in {408, 429, 500, 502, 503, 504}:
                return response
            last_error = RuntimeError(f"retryable provider status {response.status_code}")
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            last_error = error
        if attempt < settings.provider_retries:
            await asyncio.sleep(0.5 * (2**attempt))
    raise RuntimeError("provider retries exhausted") from last_error


async def call_groq(client: httpx.AsyncClient, payload: ChatRequest) -> ProviderResult:
    if not settings.groq_api_key:
        raise RuntimeError("Groq is not configured")
    response = await request_with_retry(
        client,
        "POST",
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        json={"model": settings.groq_model, "messages": [message.model_dump() for message in payload.messages], "max_completion_tokens": min(payload.max_output_tokens, settings.max_output_tokens)},
    )
    response.raise_for_status()
    data = response.json()
    usage = data.get("usage", {})
    return ProviderResult(provider="groq", model=settings.groq_model, content=data["choices"][0]["message"]["content"], input_tokens=usage.get("prompt_tokens", 0), output_tokens=usage.get("completion_tokens", 0))


async def call_gemini(client: httpx.AsyncClient, payload: ChatRequest) -> ProviderResult:
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini is not configured")
    contents = [
        {"role": "model" if message.role == "assistant" else "user", "parts": [{"text": message.content}]}
        for message in payload.messages
        if message.role != "system"
    ]
    system_messages = [message.content for message in payload.messages if message.role == "system"]
    body: dict = {"contents": contents, "generationConfig": {"maxOutputTokens": min(payload.max_output_tokens, settings.max_output_tokens)}}
    if system_messages:
        body["systemInstruction"] = {"parts": [{"text": "\n".join(system_messages)}]}
    response = await request_with_retry(client, "POST", f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent", headers={"x-goog-api-key": settings.gemini_api_key}, json=body)
    response.raise_for_status()
    data = response.json()
    usage = data.get("usageMetadata", {})
    content = "".join(part.get("text", "") for part in data["candidates"][0]["content"]["parts"])
    return ProviderResult(provider="gemini", model=settings.gemini_model, content=content, input_tokens=usage.get("promptTokenCount", 0), output_tokens=usage.get("candidatesTokenCount", 0))


async def provider_fallback(payload: ChatRequest) -> ProviderResult:
    errors: list[str] = []
    timeout = httpx.Timeout(settings.provider_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for name, provider in (("groq", call_groq), ("gemini", call_gemini)):
            try:
                return await provider(client, payload)
            except Exception as error:
                logger.warning("provider_failed provider=%s error_type=%s", name, type(error).__name__)
                errors.append(name)
    configured = [name for name, key in (("groq", settings.groq_api_key), ("gemini", settings.gemini_api_key)) if key]
    if not configured:
        raise HTTPException(status_code=503, detail={"code": "no_ai_provider_configured"})
    raise HTTPException(status_code=502, detail={"code": "all_ai_providers_failed", "providers": errors})


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    started = time.monotonic()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    response.headers["x-response-time-ms"] = str(round((time.monotonic() - started) * 1000))
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "providers": {"groq": bool(settings.groq_api_key), "gemini": bool(settings.gemini_api_key)}}


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, user: AuthenticatedUser = Depends(authenticated_user)) -> ChatResponse:
    reservation_id = await reserve_quota(user.id, payload)
    try:
        result = await provider_fallback(payload)
    except Exception:
        await finalize_quota(reservation_id, "failed")
        raise
    await finalize_quota(reservation_id, "completed", result)
    usage = Usage(input_tokens=result.input_tokens, output_tokens=result.output_tokens, total_tokens=result.input_tokens + result.output_tokens)
    return ChatResponse(id=str(reservation_id), provider=result.provider, model=result.model, content=result.content, usage=usage)
