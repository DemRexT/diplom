"""Local OCR for image-only PDF pages; no external document upload."""
import math
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException
import pypdfium2 as pdfium

MAX_OCR_PAGES = 50
OCR_BUDGET_SECONDS = 300
MAX_PIXELS = 12_000_000


def tesseract_settings():
    executable = os.getenv('TESSERACT_CMD') or shutil.which('tesseract')
    if not executable:
        candidate = Path(os.getenv('ProgramFiles', r'C:\Program Files')) / 'Tesseract-OCR' / 'tesseract.exe'
        if candidate.is_file():
            executable = str(candidate)
    if not executable:
        raise HTTPException(503, 'Для PDF-сканов установите Tesseract OCR с языками rus и eng. '
                            'При необходимости задайте TESSERACT_CMD — путь к tesseract.exe.')
    languages = os.getenv('OCR_LANG', 'rus+eng')
    directory = os.getenv('OCR_TESSDATA_DIR')
    retained = Path(__file__).resolve().parent.parent / 'var' / 'tessdata'
    if not directory and retained.is_dir():
        directory = str(retained)
    extra = ['--tessdata-dir', directory] if directory else []
    try:
        check = subprocess.run([executable, '--list-langs', *extra], capture_output=True,
                               text=True, encoding='utf-8', errors='replace', timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        raise HTTPException(503, 'Не удалось запустить Tesseract OCR. Проверьте TESSERACT_CMD.')
    available = set(check.stdout.splitlines()[1:])
    if check.returncode or not all(language in available for language in languages.split('+')):
        raise HTTPException(503, 'Для распознавания не хватает языков Tesseract. Установите rus и eng '
                            'или проверьте OCR_LANG и OCR_TESSDATA_DIR.')
    return executable, languages, extra


def recognize_pages(data: bytes, indices: list[int]) -> dict[int, str]:
    if len(indices) > MAX_OCR_PAGES:
        raise HTTPException(413, 'В одном файле допускается до 50 страниц для OCR. Загрузите отдельную главу.')
    executable, languages, extra = tesseract_settings()
    deadline = time.monotonic() + OCR_BUDGET_SECONDS
    results = {}
    with pdfium.PdfDocument(data) as document, tempfile.TemporaryDirectory(prefix='study-ocr-') as directory:
        for index in indices:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HTTPException(504, 'Распознавание заняло слишком много времени. Загрузите меньше страниц.')
            page = document[index]
            try:
                width, height = page.get_size()
                if not math.isfinite(width * height) or width <= 0 or height <= 0:
                    raise HTTPException(422, 'Некорректный размер страницы PDF.')
                scale = min(200 / 72, math.sqrt(MAX_PIXELS / (width * height)), 10000 / width, 10000 / height)
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil()
                    try:
                        path = Path(directory) / 'page.png'
                        image.save(path)
                    finally:
                        image.close()
                finally:
                    bitmap.close()
            finally:
                page.close()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HTTPException(504, 'Распознавание заняло слишком много времени. Загрузите меньше страниц.')
            try:
                result = subprocess.run([executable, str(path), 'stdout', '-l', languages, *extra],
                                        capture_output=True, text=True, encoding='utf-8', errors='replace',
                                        timeout=min(30, remaining))
            except subprocess.TimeoutExpired:
                raise HTTPException(504, 'Страница распознаётся слишком долго. Попробуйте более короткий PDF.')
            except OSError:
                raise HTTPException(503, 'Не удалось запустить Tesseract OCR.')
            if result.returncode:
                raise HTTPException(422, 'Tesseract не смог распознать страницу. Проверьте качество скана.')
            results[index] = result.stdout.strip()
    return results
