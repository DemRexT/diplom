import json
from sqlalchemy import select
from app.store import Material
from test_accounts import accounts, login
from test_app import RESULT
from test_generation import mock_yandex, reply


def test_formulas_and_diagram_survive_generation_storage_and_loading(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    summary = r'''## Нечёткое множество

\(A=\{(x,\mu_A(x))\mid x\in X\}\).

\[
\mu_A(x)=\frac{1}{1+x^2}
\]

```mermaid
flowchart LR
  A["Элемент"] --> B["Принадлежность"]
```
'''
    result = {**RESULT, 'summary': summary}
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(result, ensure_ascii=False)))
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Материал по нечётким множествам. ' * 20).encode())})
    assert response.status_code == 200
    material_id = response.json()['id']
    assert response.json()['summary'] == summary
    assert teacher.get(f'/api/materials/{material_id}').json()['summary'] == summary
    with database() as session:
        material = session.scalar(select(Material).where(Material.id == material_id))
        assert json.loads(material.content)['summary'] == summary
