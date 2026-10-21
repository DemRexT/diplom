"""Optional activities: keep valid items, skip failures without losing the lesson."""
import json
import re
import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from .interactive import ActivityBatch, InteractiveLab, TheoryChallenge, GeneratedModule
from .llm import INTERACTIVE_GUIDANCE, complete, logger, split_text, provider_name

ACTIVITY_CHARS = 8000


async def create_activities(client, source, summary, *, key, folder, on_progress=None):
    labs, challenges, modules = [], [], []
    pieces = split_text(source, ACTIVITY_CHARS)
    headings = '\n'.join(re.findall(r'^#{1,6}\s+(.+)$', summary, re.M))[:4000]
    schema = json.dumps(ActivityBatch.model_json_schema(), ensure_ascii=False)
    for index, piece in enumerate(pieces, 1):
        if on_progress:
            await on_progress({'completed': index - 1, 'total': len(pieces), 'accepted': len(labs) + len(challenges) + len(modules)})
        system = '[THEORY_ACTIVITIES]\n' + INTERACTIVE_GUIDANCE + f'\nФрагмент {index}/{len(pieces)}. topic выбирай из подходящих заголовков конспекта:\n{headings}\nJSON Schema:\n{schema}'
        try:
            content = await complete(client, system, piece, key=key, folder=folder,
                                     structured=True, max_tokens=8000,
                                     stage=f'интерактив раздела {index}/{len(pieces)}')
        except (httpx.HTTPError, HTTPException) as error:
            logger.warning(f'[{"GigaChat" if provider_name() == "gigachat" else "YandexGPT"}] Интерактив остановлен на разделе %s/%s (%s); готовый материал будет сохранён без оставшихся активностей', index, len(pieces), type(error).__name__)
            break
        try:
            batch = json.loads(content)
            if not isinstance(batch, dict):
                raise ValueError('Expected object')
        except (ValueError, TypeError):
            logger.warning(f'[{"GigaChat" if provider_name() == "gigachat" else "YandexGPT"}] Интерактив раздела %s/%s пропущен: неверный JSON; готовый конспект сохранится', index, len(pieces))
            continue
        for field, model, target in [('labs', InteractiveLab, labs), ('challenges', TheoryChallenge, challenges), ('modules', GeneratedModule, modules)]:
            items = batch.get(field, [])
            if not isinstance(items, list):
                logger.warning(f'[{"GigaChat" if provider_name() == "gigachat" else "YandexGPT"}] Интерактив раздела %s/%s: %s пропущен — ожидался массив', index, len(pieces), field)
                continue
            for item_index, item in enumerate(items[:2 if field == 'modules' else 8]):
                try:
                    target.append(model.model_validate(item))
                except ValidationError as error:
                    logger.warning(f'[{"GigaChat" if provider_name() == "gigachat" else "YandexGPT"}] Пропущен интерактив раздела %s/%s %s[%s]: %s', index, len(pieces), field, item_index,
                                   error.errors(include_input=False, include_context=False, include_url=False))
    if on_progress:
        await on_progress({'completed': index if pieces else 0, 'total': len(pieces), 'accepted': len(labs) + len(challenges) + len(modules), 'done': True})
    return labs, challenges, modules
