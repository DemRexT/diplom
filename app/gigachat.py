"""GigaChat OAuth and completions; tokens are cached only for one HTTP client."""
import asyncio
from dataclasses import dataclass, field
import hashlib
import time
import uuid
from weakref import WeakKeyDictionary
import os

import httpx
from fastapi import HTTPException
from .llm import logger, safe_diagnostic, provider_diagnostic

OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions'


@dataclass
class TokenState:
    fingerprint: str = ''
    token: str = ''
    expires: float = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_tokens = WeakKeyDictionary()


async def check_response(response, stage, *secrets):
    request_id = safe_diagnostic(response.headers.get('x-request-id') or response.headers.get('x-rquid') or 'не указан', *secrets)
    if not response.is_success:
        logger.error('[GigaChat] Этап: %s | HTTP %s | request_id=%s | %s', stage, response.status_code, request_id, provider_diagnostic(response, *secrets))
    if response.status_code == 429:
        raise HTTPException(503, 'GigaChat ограничил частоту запросов. Попробуйте позже.')
    response.raise_for_status()
    return request_id


async def access_token(client, key):
    scope = os.getenv('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS').strip()
    fingerprint = hashlib.sha256((key + '\0' + scope).encode()).hexdigest()
    state = _tokens.setdefault(client, TokenState())
    async with state.lock:
        if state.fingerprint == fingerprint and state.token and state.expires > time.time() + 30:
            return state.token
        response = await client.post(OAUTH_URL,
            headers={'Authorization': 'Basic ' + key, 'RqUID': str(uuid.uuid4()), 'Accept': 'application/json'},
            data={'scope': scope})
        await check_response(response, 'получение токена', key)
        try:
            data = response.json()
            token, expires = data['access_token'], data['expires_at']
            if not isinstance(token, str) or not token.strip() or type(expires) not in (int, float) or not time.time() * 1000 < expires < 1e16:
                raise ValueError('Invalid token response')
        except (ValueError, KeyError, TypeError):
            logger.error('[GigaChat] Некорректный ответ авторизации; тело ответа не записано')
            raise HTTPException(502, 'GigaChat вернул некорректный токен доступа.')
        state.fingerprint, state.token, state.expires = fingerprint, token, expires / 1000
        return token


async def complete_gigachat(client, system, text, *, key, structured, max_tokens, stage):
    key = key.removeprefix('Basic ').strip()
    model = os.getenv('GIGACHAT_MODEL', 'GigaChat').strip()
    logger.info('[GigaChat] Этап: %s | модель=%s | вход=%s символов | maxTokens=%s', stage, safe_diagnostic(model, key), len(text), max_tokens)
    # GigaChat's REST interface is not assumed to support OpenAI's response_format.
    # The full JSON Schema is already part of the calling prompt.
    if structured:
        system += '\nВерни только один корректный JSON-объект по указанной схеме, без блока ``` и пояснений вокруг JSON.'
    try:
        token = await access_token(client, key)
        response = await client.post(CHAT_URL, headers={'Authorization': 'Bearer ' + token},
            json={'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': text}],
                  'temperature': .2, 'max_tokens': max_tokens, 'stream': False})
        # A server may invalidate a token earlier than expires_at. Refresh once on
        # an explicit 401; never retry timeouts, quota errors or uncertain requests.
        if response.status_code == 401:
            logger.warning('[GigaChat] Этап: %s | HTTP 401: обновляем токен один раз', stage)
            _tokens[client].expires = 0
            token = await access_token(client, key)
            response = await client.post(CHAT_URL, headers={'Authorization': 'Bearer ' + token},
                json={'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': text}],
                      'temperature': .2, 'max_tokens': max_tokens, 'stream': False})
        request_id = await check_response(response, stage, key, token, text, system)
    except httpx.TimeoutException:
        logger.error('[GigaChat] Этап: %s | тайм-аут запроса', stage)
        raise
    except httpx.HTTPError as error:
        logger.error('[GigaChat] Этап: %s | ошибка соединения или HTTP: %s', stage, type(error).__name__)
        raise
    try:
        choice = response.json()['choices'][0]
        reason, content = choice.get('finish_reason'), choice['message']['content']
        if reason != 'stop':
            logger.error('[GigaChat] Этап: %s | request_id=%s | незавершённый ответ: %s', stage, request_id, safe_diagnostic(reason, key, token))
            raise HTTPException(502, 'GigaChat не завершил ответ: лимит длины или ограничение содержимого.')
        if not isinstance(content, str) or not content.strip():
            raise ValueError('Empty answer')
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        logger.error('[GigaChat] Этап: %s | request_id=%s | некорректный или пустой ответ; тело не записано', stage, request_id)
        raise HTTPException(502, 'GigaChat вернул пустой или некорректный ответ.')
    logger.info('[GigaChat] Этап: %s | HTTP %s | request_id=%s | ответ получен: %s символов', stage, response.status_code, request_id, len(content))
    return content
