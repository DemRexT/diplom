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
SOURCE = 'Глава 1. Тензоры\n\nПолный текст методички <img src=x onerror="window.pwned=1"> без обработки.'
MATERIAL = {'id': 42, 'published': True, 'quiz_revision': 1, 'title': 'Тензоры',
            'teacher_name': 'Teacher', 'group_name': 'Group', 'summary': SUMMARY, 'source': SOURCE,
            'quiz': [{'question': 'Порядок?', 'options': ['1', '2', '3', '4']}]}
ANSWER = {'id': 1, 'question': 'Что такое свёртка?', 'answer': 'Свёртка — сумма \\(a_{11}+a_{22}\\).',
          'created_at': '2026-01-01T00:00:00+00:00', 'author_name': 'Student'}


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
                payload = ({'id': 1, 'role': 'student', 'name': 'Student', 'group': 'Group'} if url.path == '/api/auth/me'
                           else MATERIAL if url.path == '/api/materials/42'
                           else [] if url.path.endswith('/questions') and request.request.method == 'GET'
                           else ANSWER if url.path.endswith('/questions') else {'ok': True})
                request.fulfill(content_type='application/json', body=json.dumps(payload))
                return
            file = ROOT / 'app' / 'static' / url.path.removeprefix('/static/') if url.path.startswith('/static/') else ROOT / 'app/static/index.html'
            request.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
        page.route('**/*', route)
        page.goto('http://study.local/materials/42', wait_until='networkidle')
        page.wait_for_selector('#summary table')
        assert page.locator('#summary .katex-error').count() == 0
        assert page.locator('#summary .study-math-error').count() == 1
        assert page.locator('#summary .katex [class*=brace]').count() > 0
        assert page.locator('#summary table th').count() == 2
        assert page.locator('#summary table td').count() == 2
        page.locator('.study-math-error button').click()
        assert page.locator('.study-math-error code').inner_text() == r'\frac{1}{'
        # The full methodology is plain text: markup inside it is shown, never executed.
        page.locator('[data-tab=source]').click()
        assert page.locator('#source .source-text').inner_text() == SOURCE
        assert page.locator('#source img').count() == 0
        page.locator('[data-tab=ask]').click()
        page.locator('#ask textarea').fill(ANSWER['question'])
        page.locator('#ask button', has_text='Спросить').click()
        page.wait_for_selector('#ask .qa-item')
        assert page.locator('#ask .qa-question .qa-text').inner_text() == ANSWER['question']
        assert page.locator('#ask .qa-answer .katex').count() == 1
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if args.screenshot: page.screenshot(path=args.screenshot, full_page=True)
        assert page.evaluate('window.pwned') is None
        assert not external, external
        assert not errors, errors
        assert writes == ['/api/materials/42/view', '/api/materials/42/questions'], writes
        assert MATERIAL['summary'] == SUMMARY
        print('Browser checks passed: underbrace, invalid-formula fallback, math/table pipes, plain-text source, question answer, mobile layout.')
        browser.close()


if __name__ == '__main__':
    main()
