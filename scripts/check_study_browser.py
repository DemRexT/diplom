"""Optional isolated UI regression: pip install playwright; playwright install chromium.

Run: python scripts/check_study_browser.py [--chromium /path/to/chromium]
No server, API credentials or database required; all requests use local fixtures.
"""
import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SUMMARY = r'''## Определение тензора

**Определение.** Пример группировки пространств:
\[\varphi:\underbrace{V\times\cdots\times V}_{q\text{ штук}}\to K.\]

## Свёртка тензоров

\[\varphi'_{k_1\ldots k_p}^{l_1\ldots l_q}=\varphi(e'_{l_1},e'^{k_1}).\]

| Величина | Формула |
| --- | --- |
| Множество | $A=\{(x,\mu_A(x)) | x\in X\}$ |

## Повреждённая формула

\[\frac{1}{\]

<img src="https://invalid.example/x" onerror="window.pwned=1">
'''
LAB = {
    'title': 'Свёртка матрицы', 'topic': 'Свёртка тензоров',
    'explanation': 'Свёртка тензора типа (1,1) — сумма диагональных компонент.',
    'task': 'Измени компоненты. Как сохранить сумму равной пяти?',
    'formula': r'\(s=a_{11}+a_{22}\)',
    'parameters': [
        {'name': 'a11', 'label': 'Компонента a11', 'minimum': -5, 'maximum': 5, 'step': .5, 'initial': 2},
        {'name': 'a22', 'label': 'Компонента a22', 'minimum': -5, 'maximum': 5, 'step': .5, 'initial': 3},
    ],
    'outputs': [{'label': 'Свёртка', 'expression': 'a11+a22', 'unit': ''}], 'plot_variable': 'a11',
}
MATERIAL = {'id': 42, 'published': True, 'quiz_revision': 1, 'title': 'Тензоры',
            'teacher_name': 'Teacher', 'group_name': 'Group', 'summary': SUMMARY,
            'key_points': ['**Свёртка** уменьшает порядок.'],
            'cards': [{'term': 'Тензор', 'explanation': 'Полилинейное отображение.'}],
            'quiz': [{'question': 'Порядок?', 'options': ['1', '2', '3', '4']}], 'labs': [LAB]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium')
    parser.add_argument('--screenshot')
    args = parser.parse_args()
    writes, external, errors = [], [], []
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
            if url.path.startswith('/api/'):
                if request.request.method != 'GET': writes.append(url.path)
                payload = {'id': 1, 'role': 'student', 'name': 'Student', 'group': 'Group'} if url.path == '/api/auth/me' else MATERIAL if url.path == '/api/materials/42' else {'ok': True}
                request.fulfill(content_type='application/json', body=json.dumps(payload))
                return
            file = ROOT / 'app' / 'static' / url.path.removeprefix('/static/') if url.path.startswith('/static/') else ROOT / 'app/static/index.html'
            request.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
        page.route('**/*', route)
        page.goto('http://study.local/materials/42', wait_until='networkidle')
        page.wait_for_selector('.study-lab')
        assert page.locator('.lab-results strong').inner_text() == '5'
        assert page.locator('.lab-chart svg polyline').count() == 1
        assert page.locator('#summary .katex-error').count() == 0
        assert page.locator('#summary .study-math-error').count() == 1
        assert page.locator('#summary .katex [class*=brace]').count() > 0
        assert page.locator('#summary table th').count() == 2
        assert page.locator('#summary table td').count() == 2
        # Lab is embedded beside its topic, before the next section.
        assert page.locator('.study-lab').evaluate('(el)=>el.nextElementSibling.textContent') == 'Повреждённая формула'
        page.locator('.study-math-error button').click()
        assert page.locator('.study-math-error code').inner_text() == r'\frac{1}{'
        before = page.locator('.lab-chart svg circle').get_attribute('cy')
        page.get_by_role('spinbutton', name='Компонента a11 — число').fill('4')
        assert page.locator('.lab-results strong').inner_text() == '7'
        assert page.locator('.lab-chart svg circle').get_attribute('cy') != before
        slider = page.get_by_role('slider', name='Компонента a11 — ползунок')
        slider.fill('1')
        assert page.locator('.lab-results strong').inner_text() == '4'
        assert page.get_by_role('spinbutton', name='Компонента a11 — число').input_value() == '1'
        page.locator('.study-lab button', has_text='Сбросить').click()
        assert page.locator('.lab-results strong').inner_text() == '5'
        page.locator('.study-lab summary').click()
        assert page.locator('.study-lab details code').inner_text() == 'a11+a22'
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if args.screenshot: page.screenshot(path=args.screenshot, full_page=True)
        # Undefined values produce a message, not Infinity or a broken page.
        page.evaluate("""() => {
          const root = document.createElement('div'); root.id='domain-test'; document.body.append(root);
          const lab = {title:'Деление', topic:'', explanation:'Пример', task:'Измени x', formula:'1/x',
            parameters:[{name:'x',label:'x',minimum:-1,maximum:1,step:1,initial:0}],
            outputs:[{label:'Результат',expression:'1/x'}],plot_variable:'x'};
          window.StudyLabs.render(root,[lab]);
        }""")
        assert page.locator('#domain-test .lab-domain-error').count() == 1
        assert page.locator('#domain-test svg polyline').count() == 2
        assert page.evaluate('window.pwned') is None
        assert not external, external
        assert not errors, errors
        assert writes == ['/api/materials/42/view'], writes
        assert MATERIAL['summary'] == SUMMARY
        print('Browser checks passed: prime indices, underbrace, invalid-formula fallback, math/table pipes, embedded lab, sliders/results/plot/reset, domain errors, mobile layout, no material writes.')
        browser.close()


if __name__ == '__main__':
    main()
