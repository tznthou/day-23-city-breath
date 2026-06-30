"""
Zeabur 入口點（開發環境用）
生產環境由 Procfile 透過 gunicorn CLI 啟動
"""
import os

from src.app import app

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
