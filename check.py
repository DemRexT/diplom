import getpass
import uuid
import ssl
import httpx

key = getpass.getpass("Ключ авторизации GigaChat: ").strip()
context = ssl.create_default_context()
context.load_verify_locations(
    cafile=r"C:\Users\danil\certificates\russian_trusted_root_ca_pem.crt"
)

with httpx.Client(verify=context, timeout=30) as client:
    auth = client.post(
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        headers={
            "Authorization": "Basic " + key.removeprefix("Basic "),
            "RqUID": str(uuid.uuid4()),
        },
        data={"scope": "GIGACHAT_API_PERS"},
    )
    auth.raise_for_status()
    response = client.get(
        "https://api.giga.chat/v1/models",
        headers={"Authorization": "Bearer " + auth.json()["access_token"]},
    )
    print("HTTP:", response.status_code)
    print(response.text)