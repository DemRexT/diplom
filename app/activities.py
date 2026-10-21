"""Generate activities from every original fragment, not from compressed overview notes."""
import json
import re
from fastapi import HTTPException
from pydantic import ValidationError
from .interactive import ActivityBatch
from .llm import INTERACTIVE_GUIDANCE, complete, logger, split_text

ACTIVITY_CHARS = 8000


async def create_activities(client, source, summary, *, key, folder):
    labs, challenges = [], []
    pieces = split_text(source, ACTIVITY_CHARS)
    # Help the model place each activity next to a real heading in the completed summary.
    headings = '\n'.join(re.findall(r'^#{1,6}\s+(.+)$', summary, re.M))[:4000]
    schema = json.dumps(ActivityBatch.model_json_schema(), ensure_ascii=False)
    for index, piece in enumerate(pieces, 1):
        system = '[THEORY_ACTIVITIES]\n' + INTERACTIVE_GUIDANCE + f'\nФрагмент {index}/{len(pieces)}. topic выбирай из подходящих заголовков конспекта:\n{headings}\nJSON Schema:\n{schema}'
        text = piece
        for attempt in range(2):
            content = await complete(client, system, text, key=key, folder=folder,
                                     structured=True, max_tokens=6000,
                                     stage=f'интерактив раздела {index}/{len(pieces)}' + (' — исправление 1/1' if attempt else ''))
            try:
                batch = ActivityBatch.model_validate_json(content)
                labs.extend(batch.labs)
                challenges.extend(batch.challenges)
                logger.info('[YandexGPT] Интерактив раздела %s/%s: экспериментов=%s, заданий=%s',
                            index, len(pieces), len(batch.labs), len(batch.challenges))
                break
            except ValidationError as error:
                issues = error.errors(include_input=False, include_context=False, include_url=False)
                logger.error('[YandexGPT] Проверка интерактива раздела %s/%s: %s', index, len(pieces), issues)
                if attempt:
                    raise HTTPException(502, 'Нейросеть не смогла подготовить интерактив раздела. Материал не сохранён; попробуйте ещё раз.')
                # Repair only this fragment. Never repeat good chapters or earlier activities.
                text = json.dumps({'source': piece, 'validation_errors': issues}, ensure_ascii=False)
                system += '\nИсправь ошибки структуры и вычислений. source — единственный источник фактов. Верни оба массива labs и challenges.'
    return labs, challenges
