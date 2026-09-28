import os

import pytest
from pydantic import ValidationError

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "publishable")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role")

from fastapi.testclient import TestClient

from app import ChatRequest, ChatMessage, app, estimate_tokens


client = TestClient(app)


def test_health_does_not_expose_secrets():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "providers": {"groq": False, "gemini": False}}
    assert "service-role" not in response.text


def test_chat_requires_authentication():
    response = client.post("/v1/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"


def test_token_reservation_is_conservative():
    request = ChatRequest(messages=[ChatMessage(role="user", content="hello")], max_output_tokens=100)
    assert estimate_tokens(request) == 105


def test_rejects_oversized_message():
    with pytest.raises(ValidationError):
        ChatRequest(messages=[ChatMessage(role="user", content="x" * 12_001)])
