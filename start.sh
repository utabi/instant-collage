#!/bin/bash

# コラージュアプリ起動スクリプト

cd "$(dirname "$0")"

echo "=== サーバー起動 ==="
echo "Python仮想環境をセットアップ中..."

# 仮想環境作成（なければ）
if [ ! -d "server/venv" ]; then
    python3 -m venv server/venv
fi

# 依存関係インストール
source server/venv/bin/activate
pip install -r server/requirements.txt -q

echo "バックエンドサーバー起動中 (http://localhost:8000)..."
cd server
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
SERVER_PID=$!
cd ..

echo "=== フロントエンド起動 ==="
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "=========================================="
echo "  コラージュアプリが起動しました"
echo "  フロントエンド: http://localhost:5173"
echo "  バックエンド:   http://localhost:8000"
echo "=========================================="
echo ""
echo "終了するには Ctrl+C を押してください"

# 終了時にプロセスをクリーンアップ
trap "kill $SERVER_PID $FRONTEND_PID 2>/dev/null" EXIT

wait
