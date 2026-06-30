import os

from src.app import app

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("ZEABUR_ENVIRONMENT") is None
    app.run(host="0.0.0.0", port=port, debug=debug)
