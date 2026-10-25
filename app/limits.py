"""In-process limits for password guessing and paid model requests.

State lives in one server process. Behind several workers or a reverse proxy, add limits
on the proxy too; there every client may share the proxy's address.
"""
import math
import threading
import time
from collections import deque
from fastapi import HTTPException


def minutes(seconds):
    return max(1, math.ceil(seconds / 60))


class FailureLimiter:
    """Refuse attempts for a key after too many failures within the window."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.lock = threading.Lock()
        self.failures: dict[tuple, deque] = {}

    def _recent(self, key, now):
        history = self.failures.get(key)
        while history and history[0] <= now - self.window:
            history.popleft()
        if history is not None and not history:
            del self.failures[key]
            return None
        return history

    def check(self, *keys):
        now = time.monotonic()
        with self.lock:
            for key in keys:
                history = self._recent(key, now)
                if history and len(history) >= self.limit:
                    wait = history[0] + self.window - now
                    raise HTTPException(429, f'Слишком много неудачных попыток входа. Повторите через {minutes(wait)} мин.',
                                        headers={'Retry-After': str(math.ceil(wait))})

    def failed(self, *keys):
        now = time.monotonic()
        with self.lock:
            for key in keys:
                self._recent(key, now)
                self.failures.setdefault(key, deque()).append(now)

    def reset(self, *keys):
        with self.lock:
            for key in keys:
                self.failures.pop(key, None)

    def clear(self):
        with self.lock:
            self.failures.clear()


class RequestLimiter:
    """One running request per user, a bounded number per window, and a global concurrency cap."""
    STALE_SECONDS = 1800  # Drops a lease a disconnected stream never released.

    def __init__(self, per_window, window, concurrent, busy, overloaded, exhausted):
        self.per_window, self.window, self.concurrent = per_window, window, concurrent
        self.busy, self.overloaded, self.exhausted = busy, overloaded, exhausted
        self.lock = threading.Lock()
        self.active: dict[int, float] = {}
        self.started: dict[int, deque] = {}

    def acquire(self, user_id):
        now = time.monotonic()
        with self.lock:
            self.active = {user: since for user, since in self.active.items() if now - since < self.STALE_SECONDS}
            if user_id in self.active:
                raise HTTPException(429, self.busy)
            if len(self.active) >= self.concurrent:
                raise HTTPException(429, self.overloaded, headers={'Retry-After': '60'})
            history = self.started.setdefault(user_id, deque())
            while history and history[0] <= now - self.window:
                history.popleft()
            if len(history) >= self.per_window:
                wait = history[0] + self.window - now
                raise HTTPException(429, self.exhausted.format(minutes=minutes(wait)),
                                    headers={'Retry-After': str(math.ceil(wait))})
            history.append(now)
            self.active[user_id] = now
        released = False

        def release():
            nonlocal released
            with self.lock:
                if not released and self.active.get(user_id) == now:
                    del self.active[user_id]
                released = True
        return release

    def clear(self):
        with self.lock:
            self.active.clear()
            self.started.clear()


login_by_account = FailureLimiter(limit=10, window=900)
login_by_address = FailureLimiter(limit=50, window=900)
invites_by_address = FailureLimiter(limit=20, window=900)
generations = RequestLimiter(
    per_window=20, window=3600, concurrent=3,
    busy='Предыдущая методичка ещё обрабатывается. Дождитесь завершения.',
    overloaded='Сервер сейчас обрабатывает другие методички. Попробуйте через минуту.',
    exhausted='Достигнут лимит: 20 методичек в час. Повторите через {minutes} мин.')
questions = RequestLimiter(
    per_window=30, window=600, concurrent=20,
    busy='Дождитесь ответа на предыдущий вопрос.',
    overloaded='Сейчас много вопросов. Попробуйте через минуту.',
    exhausted='Слишком много вопросов подряд. Повторите через {minutes} мин.')


def reset_all():
    for limiter in (login_by_account, login_by_address, invites_by_address, generations, questions):
        limiter.clear()
