import io
import os
import subprocess
import pytest
from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from app import ocr, main


def native_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    text = 'Database normalization reduces data redundancy. ' * 4
    stream.set_data(f'BT /F1 12 Tf 50 750 Td ({text}) Tj ET'.encode())
    page[NameObject('/Contents')] = stream
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def scanned_pdf():
    from pathlib import Path
    candidates = [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
                  Path(os.getenv('WINDIR', r'C:\Windows')) / 'Fonts' / 'arial.ttf']
    font_path = next((path for path in candidates if path.is_file()), None)
    if font_path is None:
        pytest.skip('The integration fixture needs a Cyrillic font')
    font = ImageFont.truetype(font_path, 42)
    image = Image.new('RGB', (1654, 1800), 'white')
    draw = ImageDraw.Draw(image)
    lines = ['Базы данных хранят информацию.', 'Таблица состоит из строк и столбцов.',
             'Первичный ключ определяет запись.', 'Нормализация уменьшает повторение данных.',
             'Связи объединяют таблицы в систему.']
    for index, line in enumerate(lines):
        draw.text((80, 100 + index * 100), line, font=font, fill='black')
    output = io.BytesIO()
    image.save(output, format='PDF', resolution=150)
    image.close()
    return output.getvalue()


def require_engine():
    try:
        ocr.tesseract_settings()
    except HTTPException:
        pytest.skip('Tesseract with rus+eng is needed for the real OCR integration test')


def test_text_pdf_does_not_require_ocr(monkeypatch):
    monkeypatch.setattr(main, 'recognize_pages', lambda *_: pytest.fail('Native PDF must not invoke OCR'))
    assert 'Database normalization' in main.extract_text('native.pdf', native_pdf())


def test_real_russian_scan():
    require_engine()
    data = scanned_pdf()
    assert not (PdfReader(io.BytesIO(data)).pages[0].extract_text() or '').strip()
    text = main.extract_text('scan.pdf', data)
    assert 'базы данных' in text.lower()
    assert 'первичный ключ' in text.lower()
    assert len(text) >= 100


def test_mixed_pdf_preserves_native_text_and_recognizes_scan():
    require_engine()
    writer = PdfWriter()
    writer.append(io.BytesIO(native_pdf()))
    writer.append(io.BytesIO(scanned_pdf()))
    output = io.BytesIO()
    writer.write(output)
    text = main.extract_text('mixed.pdf', output.getvalue())
    assert text.index('Database normalization') < text.lower().index('базы данных')


def test_missing_tesseract(monkeypatch):
    monkeypatch.setenv('TESSERACT_CMD', '/nonexistent/tesseract')
    with pytest.raises(HTTPException) as error:
        ocr.tesseract_settings()
    assert error.value.status_code == 503


def test_missing_russian_language(monkeypatch):
    monkeypatch.setenv('TESSERACT_CMD', 'tesseract')
    monkeypatch.setenv('OCR_LANG', 'rus+eng')
    monkeypatch.setattr(ocr.subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a, 0, 'List of available languages (1):\neng\n', ''))
    with pytest.raises(HTTPException) as error:
        ocr.tesseract_settings()
    assert error.value.status_code == 503


def test_ocr_page_limit():
    with pytest.raises(HTTPException) as error:
        ocr.recognize_pages(b'', list(range(51)))
    assert error.value.status_code == 413


def test_ocr_timeout(monkeypatch):
    monkeypatch.setattr(ocr, 'tesseract_settings', lambda: ('tesseract', 'rus+eng', []))
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 30)
    monkeypatch.setattr(ocr.subprocess, 'run', timeout)
    with pytest.raises(HTTPException) as error:
        ocr.recognize_pages(native_pdf(), [0])
    assert error.value.status_code == 504
