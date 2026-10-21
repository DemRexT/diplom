"""Additional real-browser checks called by check_study_browser.py."""
import copy


def run(page, lab):
    labs = []
    for index, mode in enumerate(['graph', 'matrix', 'vector', 'bars', 'graph']):
        item = copy.deepcopy(lab)
        item.update(title=f'Эксперимент {index + 1}', visualization=mode)
        if mode == 'matrix':
            expressions = ['a11', 'a22', '-a22', 'a11']
        elif mode == 'vector':
            expressions = ['a11', 'a22']
        else:
            expressions = ['a11+a22', 'a11*a22']
        item['outputs'] = [{'label': f'Результат {i + 1}', 'expression': expr, 'unit': ''} for i, expr in enumerate(expressions)]
        labs.append(item)
    challenges = [
        {'kind': 'choice', 'title': 'Выбери действие', 'topic': 'Теория', 'prompt': 'Какие компоненты суммируются при свёртке матрицы?',
         'items': ['Все', 'Диагональные', 'Только первая строка'], 'answer': [1], 'explanation': 'Свёртка суммирует диагональные компоненты.'},
        {'kind': 'order', 'title': 'Собери расчёт', 'topic': 'Теория', 'prompt': 'Восстанови порядок вычисления.',
         'items': ['Записать компоненты', 'Выбрать диагональ', 'Сложить значения'], 'answer': [0, 1, 2], 'explanation': 'Сначала нужны исходные данные, затем выбираем и складываем компоненты.'},
    ]
    page.evaluate('''({labs,challenges}) => {
      const root=document.getElementById('summary'); root.replaceChildren();
      const heading=document.createElement('h2');heading.textContent='Свёртка тензоров';root.append(heading);
      window.StudyLabs.render(root,labs,challenges);
    }''', {'labs': labs, 'challenges': challenges})
    page.set_viewport_size({'width': 1100, 'height': 900})
    assert page.locator('#summary .study-lab').count() == 5  # No truncation to the first three.
    assert page.locator('#summary .study-challenge').count() == 2
    assert page.locator('#summary .activity-links button').count() == 7
    assert page.locator('#summary .study-route progress').get_attribute('max') == '7'
    first = page.locator('#summary .study-lab').nth(0)
    matrix = page.locator('#summary .study-lab').nth(1)
    vector = page.locator('#summary .study-lab').nth(2)
    bars = page.locator('#summary .study-lab').nth(3)
    assert matrix.locator('.lab-matrix-cell').count() == 4
    assert vector.locator('.lab-chart svg[aria-label^="Вектор"]').count() == 1
    assert bars.locator('.lab-bar-track').count() == 2
    matrix.get_by_role('slider', name='Компонента a11 — ползунок').fill('4')
    assert matrix.locator('.lab-matrix-cell strong').first.inner_text() == '4'
    first.locator('.lab-chart-filters select').nth(1).select_option('1')
    assert 'Результат 2' in first.locator('.lab-chart svg').get_attribute('aria-label')
    first.locator('.lab-chart-filters select').first.select_option('1')
    assert 'Компонента a22' in first.locator('.lab-chart svg').get_attribute('aria-label')
    first.locator('.lab-chart-filters select').nth(1).select_option('0')
    first.get_by_role('slider', name='Компонента a11 — ползунок').fill('4')
    first.get_by_role('button', name='Сравнить с началом', exact=True).click()
    assert '5 → 7' in first.locator('.lab-comparison').inner_text()
    svg=first.locator('.lab-chart svg')
    svg.focus()
    page.keyboard.press('Home')
    assert first.get_by_role('spinbutton', name='Компонента a22 — число').input_value() == '-5'
    page.keyboard.press('End')
    assert first.get_by_role('spinbutton', name='Компонента a22 — число').input_value() == '5'
    bounds=first.locator('.lab-chart svg').bounding_box()
    first.locator('.lab-chart svg').click(position={'x':bounds['width']/2,'y':bounds['height']/2})
    assert first.get_by_role('spinbutton', name='Компонента a22 — число').input_value() == '0'
    before = first.get_by_role('spinbutton', name='Компонента a22 — число').input_value()
    first.get_by_role('button', name='▶ Оживить', exact=True).click()
    page.wait_for_function('(before)=>document.querySelectorAll("#summary .study-lab")[0].querySelectorAll("input[type=number]")[1].value!==before', arg=before)
    first.get_by_role('button', name='❚❚ Пауза', exact=True).click()
    stopped = first.get_by_role('spinbutton', name='Компонента a22 — число').input_value()
    page.wait_for_timeout(220)
    assert first.get_by_role('spinbutton', name='Компонента a22 — число').input_value() == stopped
    # A prediction hides the numeric answer/graph/comparison until it is checked.
    first.get_by_role('button', name='🎯 Предскажи результат', exact=True).click()
    assert first.locator('.lab-results').is_hidden() and first.locator('.lab-chart').is_hidden()
    assert first.locator('.lab-comparison').is_hidden()
    expected = sum(float(first.get_by_role('spinbutton', name=f'Компонента {name} — число').input_value()) for name in ['a11', 'a22'])
    first.get_by_role('spinbutton', name='Твой прогноз').fill(str(expected + 100))
    first.locator('.lab-prediction button', has_text='Проверить').click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '0'
    first.get_by_role('spinbutton', name='Твой прогноз').fill(str(expected))
    first.locator('.lab-prediction button', has_text='Проверить').click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '1'
    first.locator('.lab-prediction button', has_text='Проверить').click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '1'
    choice = page.locator('#summary .study-challenge').nth(0)
    choice.get_by_role('button', name='Все', exact=True).click()
    choice.get_by_role('button', name='Проверить', exact=True).click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '1'
    choice.get_by_role('button', name='Диагональные', exact=True).click()
    choice.get_by_role('button', name='Проверить', exact=True).click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '2'
    order = page.locator('#summary .study-challenge').nth(1)
    for target, text in enumerate(challenges[1]['items']):
        while True:
            current = order.locator('.challenge-step span').all_text_contents().index(text)
            if current == target:
                break
            order.get_by_role('button', name=f'Поднять шаг {current+1}', exact=True).click()
    order.get_by_role('button', name='Проверить', exact=True).click()
    assert page.locator('#summary .study-route progress').get_attribute('value') == '3'
    assert page.locator('#summary .activity-links .completed').count() == 3
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Animation stops after the DOM is removed, without errors or background writes.
    first.get_by_role('button', name='▶ Оживить', exact=True).click()
    vector.get_by_role('button', name='▶ Оживить', exact=True).click()
    assert first.get_by_role('button', name='▶ Оживить', exact=True).count() == 1
    page.evaluate('document.getElementById("summary").replaceChildren()')
    page.wait_for_timeout(150)
    print('Playground checks passed: >3 labs, matrix/vector/bars, graph axes, animation/pause, comparison, predictions, choice/order missions, progress, mobile and detached-DOM cleanup.')
