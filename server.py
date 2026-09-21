import os
import io
import socket
import base64
import httpx
import qrcode
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()
load_dotenv(dotenv_path="../.env")

app = FastAPI(title="Groq Whisper Voice")

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def get_api_key() -> str:
    key = os.getenv("GROQ_API_KEY", "")
    return key


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-large-v3-turbo"),
    language: str = Form("ja"),
    api_key: str = Form(""),
):
    key = api_key if api_key else get_api_key()
    if not key:
        raise HTTPException(status_code=400, detail="Groq APIキーが設定されていません。")

    audio_data = await file.read()

    async with httpx.AsyncClient(timeout=60.0) as client:
        files_payload = {
            "file": (file.filename or "audio.webm", audio_data, file.content_type or "audio/webm"),
        }
        data_payload = {"model": model}
        if language and language != "auto":
            data_payload["language"] = language

        try:
            resp = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {key}"},
                files=files_payload,
                data=data_payload,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Groq API接続エラー: {str(e)}")

    if resp.status_code != 200:
        detail = resp.text
        try:
            detail = resp.json().get("error", {}).get("message", resp.text)
        except Exception:
            pass
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return resp.json()


@app.get("/api/health")
async def health():
    has_key = bool(get_api_key())
    return {"status": "ok", "has_server_key": has_key}


app.mount("/", StaticFiles(directory="static", html=True), name="static")


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    import uvicorn

    local_ip = get_local_ip()
    url = f"http://{local_ip}:8080"

    # QRコード生成
    qr = qrcode.QRCode(version=1, box_size=2, border=1)
    qr.add_data(url)
    qr.make(fit=True)

    print("\n" + "=" * 50)
    print("  [MIC] Groq Whisper Voice PWA")
    print("=" * 50)
    print(f"\n  PC:     http://localhost:8080")
    print(f"  Phone:  {url}")
    print("\n" + "=" * 50 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=8080)
