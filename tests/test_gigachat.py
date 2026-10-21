import asyncio
import json
import logging
import time
import uuid
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi import HTTPException
from app import main, llm
from test_app import RESULT, TEXT
from test_interactive import LAB


def setup_giga(monkeypatch, handler):
    monkeypatch.setenv('LLM_PROVIDER', 'gigachat')
    monkeypatch.setenv('GIGACHAT_CREDENTIALS', 'private-basic-key')
    monkeypatch.setenv('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS')
    monkeypatch.setenv('GIGACHAT_MODEL', 'GigaChat')
    monkeypatch.delenv('GIGACHAT_CA_BUNDLE', raising=False)
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs))


def token_reply(value='private-token', expired=False):
    return httpx.Response(200, json={'access_token': value, 'expires_at': int((time.time() + (-60 if expired else 1800)) * 1000)})


def chat_reply(content, reason='stop'):
    return httpx.Response(200, json={'choices': [{'finish_reason': reason, 'message': {'role': 'assistant', 'content': content}}]})


def test_oauth_chat_and_interactive_share_token_and_preserve_preview(monkeypatch, caplog):
    requests, previews = [], []
    def handler(request):
        requests.append(request)
        if request.url.path.endswith('/oauth'):
            assert request.headers['Authorization'] == 'Basic private-basic-key'
            assert uuid.UUID(request.headers['RqUID'])
            assert parse_qs(request.content.decode()) == {'scope': ['GIGACHAT_API_PERS']}
            return token_reply()
        assert str(request.url) == 'https://api.giga.chat/v1/chat/completions'
        assert request.headers['Authorization'] == 'Bearer private-token'
        body = json.loads(request.content)
        assert body['model'] == 'GigaChat' and body['max_tokens'] > 0
        assert body['messages'][1]['content'] == TEXT
        assert 'jsonObject' not in body and 'response_format' not in body
        if '[THEORY_ACTIVITIES]' in body['messages'][0]['content']:
            assert previews
            return chat_reply(json.dumps({'labs': [LAB], 'challenges': []}))
        return chat_reply(json.dumps(RESULT))
    setup_giga(monkeypatch, handler)
    async def preview(value): previews.append(value.summary)
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        result = asyncio.run(main.generate(TEXT, on_preview=preview))
    assert result.summary == RESULT['summary'] and len(result.labs) == 1
    assert len(requests) == 3
    assert '[GigaChat]' in caplog.text
    assert 'private-basic-key' not in caplog.text and 'private-token' not in caplog.text


def test_explicit_401_refreshes_once(monkeypatch):
    counts = {'oauth': 0, 'chat': 0}
    def handler(request):
        if request.url.path.endswith('/oauth'):
            counts['oauth'] += 1
            return token_reply(f'token-{counts["oauth"]}')
        counts['chat'] += 1
        if counts['chat'] == 1: return httpx.Response(401, json={'message': 'expired'})
        assert request.headers['Authorization'] == 'Bearer token-2'
        return chat_reply('Ответ')
    setup_giga(monkeypatch, handler)
    async def run():
        async with httpx.AsyncClient() as client:
            return await llm.complete(client, 'Инструкция', 'Текст', key='private-basic-key', folder='', structured=False, max_tokens=100)
    assert asyncio.run(run()) == 'Ответ'
    assert counts == {'oauth': 2, 'chat': 2}


@pytest.mark.parametrize('kind', ['quota', 'truncated', 'filter', 'malformed', 'empty', 'timeout', 'auth'])
def test_provider_errors_are_safe_and_no_uncertain_retry(monkeypatch, caplog, kind):
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.path.endswith('/oauth'):
            if kind == 'auth': return httpx.Response(401, json={'message': 'invalid private-basic-key'})
            return token_reply()
        if kind == 'quota': return httpx.Response(429, json={'message': 'quota private-basic-key private-token'})
        if kind == 'timeout': raise httpx.ReadTimeout('private-token', request=request)
        if kind == 'truncated': return chat_reply('PRIVATE_OUTPUT', 'length')
        if kind == 'filter': return chat_reply('PRIVATE_OUTPUT', 'blacklist')
        if kind == 'empty': return chat_reply('')
        return httpx.Response(200, json={'unexpected': 'PRIVATE_OUTPUT'})
    setup_giga(monkeypatch, handler)
    with pytest.raises(HTTPException): asyncio.run(main.generate(TEXT))
    assert len(calls) == (1 if kind == 'auth' else 2)
    assert 'private-basic-key' not in caplog.text and 'private-token' not in caplog.text
    assert 'PRIVATE_OUTPUT' not in caplog.text


def test_missing_credentials_and_unknown_provider(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER', 'gigachat')
    monkeypatch.delenv('GIGACHAT_CREDENTIALS', raising=False)
    with pytest.raises(HTTPException, match='GIGACHAT_CREDENTIALS'): llm.provider_credentials()
    monkeypatch.setenv('LLM_PROVIDER', 'unknown')
    with pytest.raises(HTTPException, match='LLM_PROVIDER'): llm.provider_credentials()


def test_bad_ca_file_does_not_disable_tls(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER', 'gigachat')
    monkeypatch.setenv('GIGACHAT_CA_BUNDLE', '/does-not-exist.pem')
    with pytest.raises(HTTPException, match='GIGACHAT_CA_BUNDLE'): llm.client_options()


def test_nearly_expired_token_is_refreshed_before_next_request(monkeypatch):
    counts = {'oauth': 0, 'chat': 0}
    def handler(request):
        if request.url.path.endswith('/oauth'):
            counts['oauth'] += 1
            return httpx.Response(200, json={'access_token': 'private-token', 'expires_at': int((time.time() + (10 if counts['oauth'] == 1 else 1800)) * 1000)})
        counts['chat'] += 1
        return chat_reply('Ответ')
    setup_giga(monkeypatch, handler)
    async def run():
        async with httpx.AsyncClient() as client:
            for _ in range(2):
                await llm.complete(client, 'Инструкция', 'Текст', key='private-basic-key', folder='', structured=False, max_tokens=100)
    asyncio.run(run())
    assert counts == {'oauth': 2, 'chat': 2}


def test_invalid_oauth_body_is_not_logged_or_used(monkeypatch, caplog):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'access_token': 'PRIVATE_BODY', 'expires_at': 0})
    setup_giga(monkeypatch, handler)
    with pytest.raises(HTTPException): asyncio.run(main.generate(TEXT))
    assert len(calls) == 1 and 'PRIVATE_BODY' not in caplog.text
