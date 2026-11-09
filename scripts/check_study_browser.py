"""Optional isolated UI regression: pip install playwright; playwright install chromium.

Run: python scripts/check_study_browser.py [--chromium /path/to/chromium] [--screenshot file.png]
No server, API credentials or database required; all requests use local fixtures.
"""
import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SUMMARY = r'''## Определение тензора

**Определение.** Пример группировки пространств:
\[\varphi:\underbrace{V\times\cdots\times V}_{q\text{ штук}}\to K.\]

```facts
2 | индекса у тензора второго ранга
\(n^2\) | компонент в пространстве размерности n
```

```terms
Тензор | полилинейное отображение
Свёртка | суммирование по паре индексов
```

## Свёртка тензоров

\[\varphi'_{k_1\ldots k_p}^{l_1\ldots l_q}=\varphi(e'_{l_1},e'^{k_1}).\]

```steps
Выбор индексов | верхний и нижний индекс
Суммирование | по совпадающему индексу
Результат | тензор меньшего ранга
```

| Величина | Формула |
| --- | --- |
| Множество | $A=\{(x,\mu_A(x)) | x\in X\}$ |

## Повреждённая формула

\[\frac{1}{\]

<img src="https://invalid.example/x" onerror="window.pwned=1">
'''
SOURCE = 'Глава 1. Тензоры\n\nПолный текст методички <img src=x onerror="window.pwned=1"> без обработки.'
QUIZ = [{'question': 'Порядок?', 'options': ['1', '2', '3', '4'], 'answer': 1, 'explanation': 'По определению.'}]
FORMATTED = r'''## Глава 1. Тензоры

**Тензор** — полилинейное отображение \(\varphi: V^q \to K\).

| Ранг | Компонент |
| --- | --- |
| 2 | \(n^2\) |

Пусть в базе три правила:

- **ПРАВИЛО 1:** **ЕСЛИ** `температура=ДА` **И** `кашель=ДА` **ТО** Грипп
- **ПРАВИЛО 2:** **ЕСЛИ** `горло=ДА` **ТО** Ангина

Так как \(c=20 \le  35 \le  d=40\) — это убывающий участок:

\[\mu _{\text{низкий}}(35) = (d - x)/(d - c) = (40 - 35)/(40 - 20) = 5/20 = 0.25\]

**Вывод из примера.** Число \(x = 35\) относится сразу к двум термам.

```figure
1
```

*Рисунок 1 — Схема машины прямого вывода*

| Правило | t.выс | кашель | насморк | горло | чихание | ломота | >5дн | глаза | Заключение | CF правила |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 1 | 1 | -1 | -1 | -1 | 1 | -1 | -1 | Подозрение на грипп | 0.70 |
| R2 | 1 | 0 | -1 | 1 | -1 | -1 | -1 | -1 | Подозрение на ангину | 0.75 |
'''
INFOGRAPHICS = [
    {'type': 'tree', 'section': 'Определение тензора', 'title': 'Виды тензоров',
     'root': {'label': 'Тензор', 'children': [{'label': 'Ковариантный', 'children': []}, {'label': 'Контравариантный', 'children': []}]}},
    {'type': 'timeline', 'section': 'Свёртка тензоров', 'items': [{'period': '1900', 'event': 'Риччи'}, {'period': '1915', 'event': 'ОТО'}]},
    {'type': 'chart', 'section': 'свёртка тензоров', 'title': 'Число компонент', 'unit': '', 'items': [{'label': 'n=2', 'value': 4}, {'label': 'n=3', 'value': 9}]},
    {'type': 'flow', 'section': 'Свёртка тензоров', 'title': 'Алгоритм свёртки',
     'nodes': [{'id': 'a', 'label': 'Начало', 'kind': 'start'}, {'id': 'b', 'label': 'Индексы совпадают?', 'kind': 'decision'},
               {'id': 'c', 'label': 'Суммировать', 'kind': 'step'}, {'id': 'd', 'label': 'Конец', 'kind': 'end'}],
     'edges': [{'from': 'a', 'to': 'b', 'label': ''}, {'from': 'b', 'to': 'c', 'label': 'да'}, {'from': 'b', 'to': 'd', 'label': 'нет'},
               {'from': 'c', 'to': 'd', 'label': ''}]},
    {'type': 'formula', 'section': 'Определение тензора', 'title': 'Число компонент', 'latex': 'N = n^{p+q}',
     'legend': [{'symbol': 'n', 'meaning': 'размерность пространства'}, {'symbol': 'p+q', 'meaning': 'ранг тензора'}]},
    {'type': 'code', 'section': 'Определение тензора', 'title': 'Свёртка в MATLAB', 'language': 'matlab',
     'code': 'T = rand(3,3);\ns = trace(T);\ndisp(s)', 'notes': [{'line': 2, 'note': 'сумма диагонали — свёртка'}, {'line': 3, 'note': 'вывод'}]},
    {'type': 'facts', 'section': 'Другая тема', 'items': [{'value': '3', 'label': 'измерения'}, {'value': '9', 'label': 'компонент'}]},
]
MATERIAL = {'id': 42, 'quiz_revision': 1, 'title': 'Тензоры', 'lang': 'ru', 'original_lang': 'ru', 'images': [{'width': 320, 'height': 130}],
            'summary': SUMMARY, 'source': SOURCE, 'formatted': FORMATTED, 'quiz': QUIZ, 'infographics': INFOGRAPHICS, 'editable': True,
            'check': {'version': 1, 'ai': False, 'words': 120, 'fixes': [], 'fix_count': 0, 'tables': 0, 'formulas': 0,
                      'suspicious': ['заключенияfiredCF']}}
CHECKED = {'version': 1, 'ai': True, 'words': 120, 'fixes': [{'original': 'системыв', 'fixed': 'системы в'}],
           'fix_count': 1, 'tables': 1, 'formulas': 2, 'suspicious': []}
ENGLISH = dict(MATERIAL, lang='en', title='Tensors', source='Chapter 1. Tensors',
               summary='## Definition\n\nA tensor.\n\n## Contraction\n\nSum over an index.',
               formatted='## Chapter 1. Tensors\n\nA **tensor** is a multilinear map.', infographics=[],
               quiz=[dict(QUIZ[0], question='Order?', explanation='By definition.')])
ANSWER = {'id': 1, 'question': 'Что такое свёртка?', 'answer': 'Свёртка — сумма \\(a_{11}+a_{22}\\).',
          'created_at': '2026-01-01T00:00:00+00:00'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium')
    parser.add_argument('--screenshot')
    args = parser.parse_args()
    writes, external, errors, bodies, keys = [], [], [], [], []
    translated = {'done': False}
    state = {'editable': True, 'formatted': FORMATTED}
    with sync_playwright() as playwright:
        launch = {'headless': True}
        if args.chromium:
            launch.update(executable_path=args.chromium, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'])
        browser = playwright.chromium.launch(**launch)
        page = browser.new_page(viewport={'width': 1100, 'height': 900})
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route(request):
            url = urlsplit(request.request.url)
            if url.netloc != 'study.local':
                external.append(request.request.url)
                request.abort()
                return
            if url.path == '/api/materials/42/images/1':
                from PIL import Image, ImageDraw
                import io
                image = Image.new('RGB', (320, 130), 'white')
                ImageDraw.Draw(image).rectangle([20, 30, 140, 100], outline=(44, 72, 56), width=4)
                out = io.BytesIO(); image.save(out, 'PNG')
                request.fulfill(content_type='image/png', body=out.getvalue())
                return
            if url.path.startswith('/api/'):
                method = request.request.method
                keys.append(request.request.headers.get('x-edit-key'))
                if method != 'GET':
                    writes.append(url.path)
                    bodies.append(request.request.post_data)
                if url.path.endswith('/translation'):
                    translated['done'] = True
                    lines = [{'type': 'heartbeat'}, {'type': 'complete', 'material': ENGLISH}]
                    request.fulfill(content_type='application/x-ndjson', body='\n'.join(json.dumps(line) for line in lines) + '\n')
                    return
                if url.path.endswith('/content'):
                    state['formatted'] = json.loads(request.request.post_data)['formatted']
                    payload = dict(MATERIAL, formatted=state['formatted'])
                elif url.path.endswith('/check'):
                    state['check'] = CHECKED
                    lines = [{'type': 'heartbeat'}, {'type': 'complete', 'material': dict(MATERIAL, check=CHECKED, formatted=state['formatted'])}]
                    request.fulfill(content_type='application/x-ndjson', body='\n'.join(json.dumps(line) for line in lines) + '\n')
                    return
                elif url.path.endswith('/share'):
                    payload = {'view_url': '/materials/42', 'edit_key': 'secret-key'}
                elif url.path == '/api/materials/42':
                    wants = parse_qs(url.query).get('lang', ['ru'])[0]
                    payload = ENGLISH if wants == 'en' and translated['done'] else MATERIAL
                    payload = dict(payload, editable=state['editable'], formatted=state['formatted'] if payload is MATERIAL else payload['formatted'])
                elif url.path.endswith('/questions'):
                    payload = [] if method == 'GET' else ANSWER
                elif url.path.endswith('/attempts'):
                    payload = {'score': 1, 'total': 1, 'feedback': []}
                else:
                    payload = {'ok': True}
                request.fulfill(content_type='application/json', body=json.dumps(payload))
                return
            file = ROOT / 'app' / 'static' / url.path.removeprefix('/static/') if url.path.startswith('/static/') else ROOT / 'app/static/index.html'
            if not file.is_file():
                request.fulfill(status=404, body='')
                return
            request.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')

        page.route('**/*', route)
        page.add_init_script("try { localStorage.setItem('study-lang', 'ru'); } catch (_) {}")
        # The editing link puts the key into this browser and removes it from the address bar.
        page.goto('http://study.local/materials/42#edit=secret-key', wait_until='networkidle')
        assert page.evaluate('location.hash') == '' and keys[-1] == 'secret-key'
        page.wait_for_selector('#summary table')
        # Two tabs; the interactive material opens first, with the chat at its bottom.
        assert page.locator('[data-tab]').count() == 2
        assert page.locator('#interactive #chat').count() == 1
        assert page.locator('#interactive').is_visible() and page.locator('#tab-interactive').get_attribute('aria-selected') == 'true'
        assert page.locator('#library, #library-panel').count() == 0
        # Formulas, tables and the broken-formula fallback.
        assert page.locator('#summary .katex-error').count() == 0
        assert page.locator('#summary .study-math-error').count() == 1
        assert page.locator('#summary .katex [class*=brace]').count() > 0
        assert page.locator('#summary table th').count() == 2
        page.locator('.study-math-error button').click()
        assert page.locator('.study-math-error code').inner_text() == r'\frac{1}{'
        # Contents and collapsible topics; infographics land in their topics, unknown sections in «Наглядно».
        assert page.locator('#toc .toc-link').count() == 3 and page.locator('#summary details.topic').count() == 4
        assert page.locator('#topic-1 .study-tree').count() == 1
        page.wait_for_function("document.querySelector('#topic-1 .study-tree')?.dataset.diagram === 'ready'")
        assert 'Ковариантный' in page.locator('#topic-1 .study-tree svg').text_content()
        # Schemes are fitted to the page: the whole scheme is seen at once, without scrolling.
        tree = page.locator('#topic-1 .study-tree .diagram-viewport')
        assert tree.evaluate('node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1')
        assert page.locator('#topic-2 .study-timeline li').count() == 2 and page.locator('#topic-2 .chart-row').count() == 2
        assert page.locator('#summary > details.topic').last.locator('summary').inner_text() == 'Наглядно'
        assert page.locator('.study-facts .fact-card').count() == 4
        # Algorithm flowchart, formula card with legend, code walkthrough with clickable lines.
        page.wait_for_function("document.querySelector('#topic-2 .study-flow')?.dataset.diagram === 'ready'")
        assert 'Индексы совпадают?' in page.locator('#topic-2 .study-flow svg').text_content()
        assert page.locator('#topic-1 .study-formula .formula-main .katex-display').count() == 1
        assert page.locator('#topic-1 .formula-legend dt .katex').count() == 2
        assert page.locator('#topic-1 .study-code .code-lines li').count() == 3
        assert 'Строка 2' in page.locator('.code-note').text_content()
        page.locator('.code-line').nth(1).click()
        assert 'вывод' in page.locator('.code-note').text_content() and page.locator('.code-lines li.active').count() == 1
        if args.screenshot:
            for name in ('flow', 'formula', 'code'):
                page.locator(f'.study-{name}').first.screenshot(path=args.screenshot.replace('.png', f'-{name}.png'))
        # Each topic can be discussed with the AI in the chat below.
        page.locator('#topic-2 .ask-topic').click()
        assert page.locator('#chat textarea').input_value() == 'Объясни подробнее тему «Свёртка тензоров»'
        page.locator('#chat textarea').fill('')
        # Infographics: facts with a formula, flip cards, step-by-step walkthrough.
        assert page.locator('.study-facts .katex').count() == 1
        assert page.locator('.term-card .term-definition:visible').count() == 0
        page.locator('.term-card').first.click()
        assert page.locator('.term-card .term-definition:visible').count() == 1
        assert page.locator('.step-title').inner_text() == 'Выбор индексов'
        page.locator('.step-nav button', has_text='Далее').click()
        assert page.locator('.step-title').inner_text() == 'Суммирование'
        page.locator('.step-dot').nth(2).click()
        assert page.locator('.step-counter').inner_text() == 'Шаг 3 из 3'
        # The quiz sits at the end of the interactive material; answers stay hidden until checked.
        assert page.locator('#quiz .quiz-choice').count() == 4 and page.locator('#quiz .feedback').count() == 0
        page.locator('#quiz button', has_text='Редактировать тест').click()
        assert page.locator('#quiz .editor-question').count() == 1
        page.locator('#quiz button', has_text='Отмена').click()
        page.locator('#quiz .quiz-choice').nth(1).click()
        page.locator('#quiz button', has_text='Проверить').click()
        page.wait_for_selector('#quiz .feedback')
        # The full methodology is plain text: markup inside it is shown, never executed.
        # The full guide is shown formatted (headings, formulas, tables); the extracted text is one click away.
        page.locator('[data-tab=source]').click()
        assert page.locator('#source .reading h2').inner_text() == 'Глава 1. Тензоры'
        assert page.locator('#source .reading table').count() == 2
        # Rules as items with emphasised keywords and values, a calculation as a framed formula, a lead-in, a picture.
        assert page.locator('#source .reading li strong', has_text='ПРАВИЛО 1:').count() == 1
        assert page.locator('#source .reading li code', has_text='температура=ДА').count() == 1
        assert page.locator('#source .reading .katex-display').count() == 1 and page.locator('#source .reading .katex').count() == 5
        assert page.locator('#source .reading p strong', has_text='Вывод из примера.').count() == 1
        page.wait_for_function("document.querySelector('#source .study-figure img')?.naturalWidth === 320")
        figure = page.locator('#source .study-figure')
        assert figure.evaluate("node => node.nextElementSibling.textContent.startsWith('Рисунок 1')")
        if args.screenshot:
            page.locator('#source .reading').screenshot(path=args.screenshot.replace('.png', '-guide.png'))
        # The whole picture is visible; a click opens it on the whole screen, Esc closes it.
        assert figure.locator('img').evaluate('img => img.getBoundingClientRect().width <= img.closest(".reading").clientWidth')
        figure.locator('button').click()
        page.wait_for_selector('.study-lightbox img')
        page.keyboard.press('Escape')
        assert page.locator('.study-lightbox').count() == 0
        # A wide table (11 columns) fits the page without a scroll bar.
        wide = page.locator('#source .study-table-viewport').last
        assert wide.evaluate('node => node.scrollWidth <= node.clientWidth + 1'), 'wide table scrolls'
        assert 'cols-8' in wide.locator('table').get_attribute('class')
        assert not page.locator('#source .source-text').is_visible()
        # The text check: report, places to look at by hand, and the author's «Проверить текст».
        assert 'ещё не проверен' in page.locator('#source .check-status').inner_text()
        assert page.locator('#source .suspicious code').inner_text() == 'заключенияfiredCF'
        page.locator('#source .check-panel button').click()
        page.wait_for_selector('#source .check-panel.checked')
        assert page.locator('#tab-source').get_attribute('aria-selected') == 'true'
        assert 'все 120 слов из файла на месте' in page.locator('#source .check-status').inner_text()
        page.locator('#source .check-panel summary').click()
        assert page.locator('#source .fix-list li').inner_text() == 'системыв → системы в'
        # Every formula is framed.
        assert page.evaluate("getComputedStyle(document.querySelector('#source .reading .katex')).borderTopStyle") == 'solid'
        page.locator('#source .source-toggle').click()
        assert page.locator('#source .source-text').inner_text() == SOURCE
        assert page.locator('#source img:not(.study-figure img)').count() == 0  # Markup in the text is never run.
        page.locator('#source .source-toggle').click()
        # Chat.
        page.locator('[data-tab=interactive]').click()
        page.locator('#chat textarea').fill(ANSWER['question'])
        page.locator('#chat button', has_text='Спросить').click()
        page.wait_for_selector('#chat .qa-item .qa-answer:not(.qa-pending)')
        assert page.locator('#chat .qa-answer .katex').count() == 1
        assert json.loads(bodies[-1]) == {'question': ANSWER['question'], 'lang': 'ru'}
        # English: interface switches at once, the material is translated and shown in English.
        page.locator('[data-lang=en]').click()
        page.wait_for_function("document.querySelector('#title').textContent === 'Tensors'")
        assert page.locator('html').get_attribute('lang') == 'en'
        assert page.locator('#tab-interactive').inner_text().strip().endswith('Interactive material')
        assert page.locator('#chat h3').inner_text() == 'AI chat'
        page.locator('[data-tab=source]').click()
        assert page.locator('#source .reading h2').inner_text() == 'Chapter 1. Tensors'
        assert '/api/materials/42/translation' in writes
        page.locator('[data-tab=interactive]').click()
        assert page.locator('#quiz legend').first.inner_text() == '1. Order?'
        assert page.locator('#quiz .quiz-edit').count() == 0  # Edited in the original language only.
        assert 'Russian' in page.locator('#quiz .quiz-note').inner_text()
        page.locator('#chat textarea').fill('What is a contraction?')
        page.locator('#chat button', has_text='Ask').click()
        page.wait_for_function("document.querySelectorAll('#chat .qa-item .qa-answer:not(.qa-pending)').length === 1")
        assert json.loads(bodies[-1])['lang'] == 'en'
        page.locator('[data-tab=interactive]').click()
        page.locator('[data-lang=ru]').click()
        page.wait_for_function("document.querySelector('#title').textContent === 'Тензоры'")
        assert page.locator('#tab-interactive').inner_text().strip().endswith('Интерактивный материал')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('[data-tab=interactive]').click()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        # The author edits the guide and shares a read-only link.
        page.set_viewport_size({'width': 1100, 'height': 900})
        page.locator('[data-tab=source]').click()
        page.locator('#source .edit-button').click()
        page.locator('#source textarea').fill('## Исправлено\n\nНовый текст \\(x^2\\).')
        page.wait_for_function("document.querySelector('#source .editor-preview h2')?.textContent === 'Исправлено'")
        page.locator('#source button', has_text='Сохранить').click()
        page.wait_for_function("document.querySelector('#source .reading h2')?.textContent === 'Исправлено'")
        assert writes[-1] == '/api/materials/42/content' and keys[-1] == 'secret-key'
        page.locator('#material-actions button', has_text='Поделиться').click()
        page.wait_for_selector('.share-panel input')
        assert page.locator('.share-panel input').first.input_value() == 'http://study.local/materials/42'
        # Opened through the shared link (no key): nothing can be edited.
        state['editable'] = False
        page.evaluate("localStorage.removeItem('study-edit-keys')")
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#summary details.topic')
        assert page.locator('#material-actions .chip').inner_text() == 'Только просмотр'
        assert page.locator('.edit-button, .quiz-edit, #material-actions button').count() == 0
        assert page.locator('#quiz .quiz-choice').count() == 4 and page.locator('#chat textarea').count() == 1
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if args.screenshot:
            page.screenshot(path=args.screenshot, full_page=True)
        assert page.evaluate('window.pwned') is None
        assert not external, external
        assert not errors, errors
        print('Browser checks passed: two tabs, formatted guide, infographics (tree, timeline, chart, facts, terms, steps) in topics, '
              'contents, quiz, chat below the material, English translation, author editing, read-only shared link, mobile layout.')
        browser.close()


if __name__ == '__main__':
    main()
