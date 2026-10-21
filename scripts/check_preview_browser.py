"""Real streaming UI smoke test; local HTTP fixture, no database or API credentials."""
import argparse
import copy
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from check_study_browser import ROOT, MATERIAL


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium')
    args = parser.parse_args()
    gate = threading.Event()
    posted = []
    result = copy.deepcopy(MATERIAL)
    result['quiz'][0].update(answer=0, explanation='Объяснение')
    result.update(published=False, quiz_revision=1)
    preview = {key: value for key, value in result.items() if key not in ('id', 'published', 'quiz_revision')}
    preview['labs'] = []
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *args): pass
        def do_POST(self):
            posted.append(self.path)
            self.rfile.read(int(self.headers['Content-Length']))
            assert self.headers['X-Study-Request'] == '1'
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
            self.send_header('Connection', 'close')
            self.end_headers()
            line = (json.dumps({'type': 'preview', 'material': preview}, ensure_ascii=False)+'\n').encode()
            # Split inside a multibyte character to exercise streaming UTF-8 decoding.
            split = next(i for i, byte in enumerate(line) if byte > 127) + 1
            self.wfile.write(line[:split]); self.wfile.flush()
            self.wfile.write(line[split:]); self.wfile.flush()
            self.wfile.write((json.dumps({'type': 'progress', 'completed': 0, 'total': 3, 'accepted': 0})+'\n').encode()); self.wfile.flush()
            gate.wait(15)
            self.wfile.write((json.dumps({'type': 'complete', 'material': result}, ensure_ascii=False)+'\n').encode()); self.wfile.flush()
            self.close_connection = True
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = f'http://127.0.0.1:{server.server_port}'
    errors = []
    try:
        with sync_playwright() as playwright:
            launch = {'headless': True}
            if args.chromium:
                launch.update(executable_path=args.chromium, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'])
            browser = playwright.chromium.launch(**launch)
            page = browser.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            def route(request):
                url = urlsplit(request.request.url)
                if request.request.method == 'POST':
                    request.continue_(); return
                if url.path.startswith('/api/'):
                    data = {'id': 1, 'role': 'teacher', 'name': 'Teacher', 'groups': [{'id': 1, 'name': 'Group', 'invite_code': 'test'}]} if url.path == '/api/auth/me' else result if url.path == '/api/materials/42' else []
                    request.fulfill(content_type='application/json', body=json.dumps(data)); return
                file = ROOT / 'app/static' / url.path.removeprefix('/static/') if url.path.startswith('/static/') else ROOT / 'app/static/index.html'
                request.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
            page.route('**/*', route)
            page.goto(base, wait_until='networkidle')
            page.locator('#target-group').select_option('1')
            page.locator('#file').set_input_files({'name': 'lecture.txt', 'mimeType': 'text/plain', 'buffer': ('Учебный материал. ' * 30).encode()})
            page.locator('#submit').click()
            page.wait_for_selector('#preview-status:not([hidden])')
            assert not gate.is_set()
            assert page.url.rstrip('/') == base
            assert page.locator('#summary').is_visible()
            assert page.locator('#title').inner_text() == result['title']
            assert page.locator('#teacher-actions').is_hidden()
            assert page.locator('#material-url').is_hidden()
            assert 'раздел 1 из 3' in page.locator('#preview-status').inner_text()
            page.locator('[data-tab=quiz]').click()
            assert page.locator('#quiz button:enabled').count() == 0
            page.locator('[data-tab=summary]').click()
            gate.set()
            page.wait_for_url(base+'/materials/42')
            page.wait_for_selector('#teacher-actions:not([hidden])')
            assert page.locator('#preview-status').is_hidden()
            assert page.locator('#material-url').input_value() == base+'/materials/42'
            assert page.locator('#summary .study-lab').count() == 1
            assert posted == ['/api/material?stream=true']
            assert not errors, errors
            print('Streaming browser check passed: readable preview before completion, UTF-8 chunks, progress, disabled draft actions, final material navigation.')
            browser.close()
    finally:
        gate.set(); server.shutdown(); server.server_close(); worker.join(timeout=2)


if __name__ == '__main__': main()
