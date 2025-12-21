"""
Zeabur 入口點
生產環境使用 Gunicorn，開發環境使用 Flask 內建伺服器
"""
import os

from src.app import app

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    is_production = os.getenv("FLASK_ENV") == "production"

    if is_production:
        # 生產環境：使用 Gunicorn
        from gunicorn.app.base import BaseApplication

        class StandaloneApplication(BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                for key, value in self.options.items():
                    if key in self.cfg.settings and value is not None:
                        self.cfg.set(key.lower(), value)

            def load(self):
                return self.application

        options = {
            "bind": f"0.0.0.0:{port}",
            "workers": 2,
            "threads": 2,
            "timeout": 120,
            "accesslog": "-",
            "errorlog": "-",
            "loglevel": "info",
        }
        StandaloneApplication(app, options).run()
    else:
        # 開發環境：使用 Flask 內建伺服器
        app.run(host="0.0.0.0", port=port, debug=True)
