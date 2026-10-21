"""Exercise generated Worker games and their isolation in a real browser, offline."""
import argparse
import copy
import json
import mimetypes
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from check_study_browser import ROOT, MATERIAL
MODULE = json.loads((ROOT / 'tests/fixtures/generated_module.json').read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium')
    parser.add_argument('--screenshot')
    args = parser.parse_args()
    fixture = copy.deepcopy(MATERIAL)
    fixture.update(labs=[], modules=[copy.deepcopy(MODULE)])
    fixture['summary'] = '## Квадрат числа\n\nИзучи зависимость и попробуй выполнить задание.'
    external, errors = [], []
    with sync_playwright() as playwright:
        launch = {'headless': True}
        if args.chromium:
            launch.update(executable_path=args.chromium, args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process'])
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(viewport={'width':1100,'height':900})
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        def route(request):
            url = urlsplit(request.request.url)
            if url.netloc != 'study.local':
                external.append(request.request.url); request.abort(); return
            if url.path.startswith('/api/'):
                data = {'id':1,'name':'Private Name','role':'student','group':'Group'} if url.path == '/api/auth/me' else fixture if url.path == '/api/materials/42' else {'ok':True}
                request.fulfill(content_type='application/json',body=json.dumps(data)); return
            file = ROOT/'app/static'/url.path.removeprefix('/static/') if url.path.startswith('/static/') else ROOT/'app/static/index.html'
            request.fulfill(body=file.read_bytes(),content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
        context.route('**/*',route)
        def open_game():
            page.goto('http://study.local/materials/42',wait_until='networkidle')
            page.wait_for_selector('.study-module')
            assert page.locator('.study-module iframe').count() == 0
            page.get_by_role('button',name='Открыть мини-игру',exact=True).click()
            page.wait_for_function("document.querySelector('.study-module [role=status]').textContent.includes('Мини-игра готова')")
            return page.frame_locator('.study-module iframe')
        game = open_game()
        assert page.locator('.study-module iframe').get_attribute('sandbox') == 'allow-scripts'
        game.locator('#answer').wait_for()
        assert game.locator('#answer').inner_text() == '4'
        game.locator('#x').fill('3')
        game.locator('#answer').filter(has_text='9').wait_for()
        assert game.locator('#scene').evaluate('(canvas)=>canvas.getContext("2d").getImageData(100,100,1,1).data[3]') == 255
        game.locator('#x').fill('4')
        page.wait_for_function("document.querySelector('.study-route progress').value===1")
        game.locator('#reset').click()
        game.locator('#answer').filter(has_text='4').wait_for()
        if args.screenshot: page.screenshot(path=args.screenshot,full_page=True)
        page.get_by_role('button',name='Остановить',exact=True).click()
        assert page.locator('.study-module iframe').count() == 0
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':1100,'height':900})
        fixture['modules'][0]['javascript'] = 'playground.onPointer("scene",p=>{if(p.pressed)playground.text("answer",Math.round(p.x));});playground.text("answer","ready");'
        game = open_game()
        bounds = game.locator('canvas').bounding_box()
        game.locator('canvas').click(position={'x':bounds['width']/2,'y':bounds['height']/2})
        game.locator('#answer').filter(has_text='300').wait_for()
        # Model code sees no DOM, account, navigation window or network API.
        safe_probe = 'playground.text("answer",[typeof document,typeof window,typeof parent,typeof fetch,typeof WebSocket,typeof Worker].join(":"));'
        fixture['modules'][0]['javascript'] = safe_probe
        game = open_game()
        assert game.locator('#answer').inner_text() == ':'.join(['undefined']*6)
        # User strings cannot escape the bootstrap script or become HTML.
        payload = '</script><script>parent.pwned=1</script>'
        fixture['modules'][0]['javascript'] = 'playground.text("answer",'+json.dumps(payload)+');'
        fixture['modules'][0]['html'] += '<img src="https://invalid.example/leak" onerror="parent.pwned=2">'
        fixture['modules'][0]['css'] = 'body{background-image:url(https://invalid.example/css-leak)}'
        game = open_game()
        assert game.locator('#answer').inner_text() == payload
        assert game.locator('img').count() == 0
        assert page.evaluate('window.pwned') is None
        # Dynamic imports are blocked by the Worker's inherited CSP.
        fixture['modules'][0]['javascript'] = 'import("https://invalid.example/code.js").catch(()=>playground.text("answer","blocked"));'
        game = open_game()
        game.locator('#answer').filter(has_text='blocked').wait_for()
        # Syntax errors and runtime failures remove only the module frame.
        for code in ['const =;', 'throw new Error("bad module");', 'while(true){}']:
            fixture['modules'][0]['javascript'] = code
            page.goto('http://study.local/materials/42',wait_until='networkidle')
            page.get_by_role('button',name='Открыть мини-игру',exact=True).click()
            page.wait_for_function("document.querySelector('.study-module [role=status]').textContent.includes('не удалось')",timeout=9000)
            assert page.locator('.study-module iframe').count() == 0
            assert page.locator('#title').inner_text() == fixture['title']
        # A deliberate slow module still leaves the parent stop button responsive.
        fixture['modules'][0]['javascript'] = 'while(true){}'
        page.goto('http://study.local/materials/42',wait_until='networkidle')
        page.get_by_role('button',name='Открыть мини-игру',exact=True).click()
        page.get_by_role('button',name='Остановить',exact=True).click(timeout=2000)
        assert page.locator('.study-module iframe').count() == 0
        fixture['modules'][0]['javascript'] = MODULE['javascript']
        open_game()
        page.evaluate('document.getElementById("summary").replaceChildren()')
        assert page.locator('.study-module iframe').count() == 0
        assert not external, external
        assert not errors, errors
        print('Generated game browser checks passed: start/stop/reset, input/canvas/progress, opaque sandbox, no DOM/network, CSP import block, markup escaping, syntax/runtime errors and infinite-loop watchdog.')
        browser.close()


if __name__ == '__main__': main()
