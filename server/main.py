from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
import httpx
from io import BytesIO
from PIL import Image
import base64
from rembg import remove
import re
import shutil
import tempfile
import random
import os
from pathlib import Path

# ディスク容量チェック（最低500MB必要）
MIN_DISK_SPACE_MB = 500

# 画像保存ディレクトリ
ASSETS_DIR = Path(__file__).parent / "assets"
ASSETS_DIR.mkdir(exist_ok=True)

def check_disk_space() -> tuple[bool, int]:
    """ディスク容量をチェック。(十分か, 空き容量MB)を返す"""
    try:
        temp_dir = tempfile.gettempdir()
        usage = shutil.disk_usage(temp_dir)
        free_mb = usage.free // (1024 * 1024)
        return free_mb >= MIN_DISK_SPACE_MB, free_mb
    except Exception:
        return True, -1  # チェック失敗時は続行

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 画像検索（Bing Image Scraping）
@app.get("/search")
async def search_images(q: str, count: int = 20):
    """キーワードでWeb画像検索（複数ページから取得してランダム抽出）"""
    try:
        all_urls = set()
        async with httpx.AsyncClient() as client:
            # 複数のオフセットから画像を収集（最大300枚程度）
            offsets = [1, 35, 70, 105, 140, 175, 210, 245, 280]
            random.shuffle(offsets)  # オフセットもシャッフル

            for offset in offsets[:5]:  # 5ページ分取得
                try:
                    resp = await client.get(
                        "https://www.bing.com/images/search",
                        params={"q": q, "form": "HDRSC2", "first": offset},
                        headers={
                            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        },
                        timeout=10.0
                    )
                    html = resp.text

                    # murl（メディアURL）を抽出
                    pattern = r'murl&quot;:&quot;(https?://[^&]+?)&quot;'
                    matches = re.findall(pattern, html)

                    for url in matches:
                        # HTMLエンティティをデコード
                        url = url.replace("\\u0026", "&")
                        all_urls.add(url)
                except Exception:
                    continue  # 1ページ失敗しても続行

        # ランダムに選択
        url_list = list(all_urls)
        random.shuffle(url_list)
        selected = url_list[:count]

        results = []
        for i, url in enumerate(selected):
            results.append({
                "url": url,
                "thumbnail": url,
                "title": f"{q} - {i+1}",
                "width": 800,
                "height": 600
            })

        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/proxy-image")
async def proxy_image(url: str):
    """CORS回避用の画像プロキシ"""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Referer": url
                },
                timeout=30.0
            )
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "image/jpeg")
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/segment")
async def segment_image(image: UploadFile = File(...)):
    """画像から背景を除去して透過PNGを返す"""
    try:
        # ディスク容量チェック
        has_space, free_mb = check_disk_space()
        if not has_space:
            raise HTTPException(
                status_code=507,
                detail=f"ディスク容量が不足しています（空き: {free_mb}MB、必要: {MIN_DISK_SPACE_MB}MB以上）。不要なファイルを削除してください。"
            )

        contents = await image.read()
        print(f"[segment] Received file: {image.filename}, size: {len(contents)} bytes, content_type: {image.content_type}")
        print(f"[segment] Disk space: {free_mb}MB available")

        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty image data received")

        input_image = Image.open(BytesIO(contents))

        # rembgで背景除去
        output_image = remove(input_image)

        # 透明部分をトリミング（getbboxで不透明領域のバウンディングボックスを取得）
        bbox = output_image.getbbox()
        if bbox:
            output_image = output_image.crop(bbox)

        # PNGとしてエンコード
        output_buffer = BytesIO()
        output_image.save(output_buffer, format="PNG")
        output_buffer.seek(0)

        # base64で返す
        b64 = base64.b64encode(output_buffer.getvalue()).decode()

        return {
            "cutout": f"data:image/png;base64,{b64}",
            "width": output_image.width,
            "height": output_image.height
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    has_space, free_mb = check_disk_space()
    return {
        "status": "ok" if has_space else "warning",
        "disk_space_mb": free_mb,
        "disk_space_ok": has_space,
        "min_required_mb": MIN_DISK_SPACE_MB
    }


@app.post("/assets/save")
async def save_asset(image_id: str = Body(...), data: str = Body(...)):
    """base64画像をファイルとして保存"""
    try:
        # data:image/png;base64,... 形式からデコード
        if data.startswith("data:"):
            header, b64data = data.split(",", 1)
        else:
            b64data = data

        image_bytes = base64.b64decode(b64data)
        file_path = ASSETS_DIR / f"{image_id}.png"
        file_path.write_bytes(image_bytes)

        return {"id": image_id, "path": str(file_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{image_id}")
async def get_asset(image_id: str):
    """保存された画像を取得"""
    file_path = ASSETS_DIR / f"{image_id}.png"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(file_path, media_type="image/png")


@app.delete("/assets/{image_id}")
async def delete_asset(image_id: str):
    """保存された画像を削除"""
    file_path = ASSETS_DIR / f"{image_id}.png"
    if file_path.exists():
        file_path.unlink()
    return {"deleted": image_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
