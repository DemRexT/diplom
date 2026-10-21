"""Download checksum-pinned official Russian and English OCR language models."""
import hashlib
import os
from pathlib import Path
import httpx

COMMIT = '87416418657359cb625c412a48b6e1d6d41c29bd'
MODELS = {
    'rus': 'e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225',
    'eng': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
}


def main():
    directory = Path(os.getenv('OCR_TESSDATA_DIR') or Path(__file__).resolve().parent.parent / 'var' / 'tessdata')
    directory.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        for language, expected in MODELS.items():
            path = directory / f'{language}.traineddata'
            if path.exists():
                if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                    raise SystemExit(f'{language}: модель уже существует и отличается. Файл не изменён; используйте отдельный OCR_TESSDATA_DIR.')
                print(f'{language}: модель уже установлена, SHA-256 проверен')
                continue
            response = client.get(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{COMMIT}/{language}.traineddata')
            response.raise_for_status()
            if hashlib.sha256(response.content).hexdigest() != expected:
                raise SystemExit(f'{language}: ошибка контрольной суммы; модель не сохранена')
            # Exclusive creation preserves a file installed by another process.
            with path.open('xb') as output:
                output.write(response.content)
            print(f'{language}: модель установлена, SHA-256 проверен')
    print('Языковые модели готовы. Движок Tesseract устанавливается отдельно.')

if __name__ == '__main__':
    main()
