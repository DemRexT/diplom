import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError
from app.interactive import InteractiveLab, evaluate
from app.main import StudyMaterial
from app.store import Material
from test_accounts import accounts, login, student as register_student
from test_app import RESULT
from test_generation import mock_yandex, reply

LAB = {
    'title': 'Свёртка матрицы', 'topic': 'Свёртка тензоров',
    'explanation': 'Дополнительный пример ИИ: свёртка тензора типа (1, 1) — сумма диагональных компонент.',
    'task': 'Измени диагональные компоненты и сравни результат.',
    'formula': r'\(s=a_{11}+a_{22}\)',
    'parameters': [
        {'name': 'a11', 'label': 'Компонента a11', 'minimum': -5, 'maximum': 5, 'step': 0.5, 'initial': 2},
        {'name': 'a22', 'label': 'Компонента a22', 'minimum': -5, 'maximum': 5, 'step': 0.5, 'initial': 3},
    ],
    'outputs': [{'label': 'Свёртка', 'expression': 'a11+a22', 'unit': ''}],
    'plot_variable': 'a11',
}


@pytest.mark.parametrize('expression,values,expected', [
    ('a11+a22', {'a11': 2, 'a22': 3}, 5),
    ('-x^2', {'x': 3}, -9), ('2^-2', {}, .25), ('2^3^2', {}, 512),
    ('sqrt(x^2+y^2)', {'x': 3, 'y': 4}, 5),
    ('max(1,min(4,5),abs(-3))', {}, 4), ('min(2)', {}, 2),
    ('sin(pi/2)+log(e)', {}, 2), ('1e-3+0.5', {}, .501),
])
def test_calculation_matches_browser_parser(expression, values, expected):
    assert evaluate(expression, values) == pytest.approx(expected)
    if not shutil.which('node'):
        return
    source = Path('app/static/labs.js').read_text()
    script = 'global.window={};\n' + source + '\nconsole.log(window.StudyLabs.evaluate(' + json.dumps(expression) + ',' + json.dumps(values) + '));'
    response = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
    assert float(response.stdout) == pytest.approx(expected)


@pytest.mark.parametrize('expression', [
    '__import__("os")', 'x.constructor', 'alert(1)', '1/0', 'sqrt(-1)',
    'unknown+2', '2^1000', '[1,2]', 'min()', 'sin(1,2)', '1e999',
])
def test_invalid_or_unsafe_expressions_are_rejected(expression):
    with pytest.raises(ValueError):
        evaluate(expression, {})
    if shutil.which('node'):
        source = Path('app/static/labs.js').read_text()
        script = 'global.window={};\n' + source + '\ntry { window.StudyLabs.evaluate(' + json.dumps(expression) + ',{}); process.exit(1); } catch (_) {process.exit(0);}'
        assert subprocess.run(['node', '-e', script], capture_output=True).returncode == 0


@pytest.mark.parametrize('change', ['duplicate', 'range', 'step', 'plot', 'expression', 'extra'])
def test_invalid_lab_configuration(change):
    lab = copy.deepcopy(LAB)
    if change == 'duplicate': lab['parameters'][1]['name'] = 'a11'
    if change == 'range': lab['parameters'][0]['initial'] = 20
    if change == 'step': lab['parameters'][0]['step'] = 0
    if change == 'plot': lab['plot_variable'] = 'missing'
    if change == 'expression': lab['outputs'][0]['expression'] = 'unknown+2'
    if change == 'extra': lab['script'] = 'alert(1)'
    with pytest.raises(ValidationError):
        InteractiveLab.model_validate(lab)


def test_existing_material_is_compatible_without_labs():
    assert StudyMaterial.model_validate(RESULT).labs == []


def test_labs_survive_generation_storage_and_student_loading(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    result = {**RESULT, 'labs': [LAB]}
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(result, ensure_ascii=False)))
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Свёртка тензора — сумма диагональных компонент. ' * 20).encode())})
    assert response.status_code == 200
    material_id = response.json()['id']
    assert response.json()['labs'][0]['outputs'][0]['expression'] == 'a11+a22'
    with database() as session:
        record = session.get(Material, material_id)
        record.published = True
        session.commit()
        original = record.content
    student = register_student()
    payload = student.get(f'/api/materials/{material_id}').json()
    assert payload['labs'][0]['parameters'][0]['initial'] == 2
    assert 'answer' not in payload['quiz'][0]
    with database() as session:
        assert session.get(Material, material_id).content == original


def test_invalid_optional_lab_is_skipped_without_replacing_summary(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    bad = copy.deepcopy(LAB)
    bad['outputs'][0]['expression'] = 'exec(1)'
    responses = [reply(json.dumps({**RESULT, 'labs': [bad]})),
                 reply(json.dumps({**RESULT, 'summary': 'Короткий ответ', 'labs': [LAB]}))]
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        return responses.pop(0)
    mock_yandex(monkeypatch, handler)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Свёртка тензора — сумма диагональных компонент. ' * 20).encode())})
    assert response.status_code == 200
    assert response.json()['summary'] == RESULT['summary']
    assert response.json()['labs'] == []
    assert len(requests) == 1
