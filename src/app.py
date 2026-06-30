"""
City Breath - 城市的呼吸
將空氣品質數據轉化為有機年輪的視覺化藝術

資料來源：環境部環境資料開放平臺
授權條款：CC BY 4.0
https://data.moenv.gov.tw
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 台灣時區 (UTC+8)
TW_TZ = timezone(timedelta(hours=8))

from flask import Flask, render_template, jsonify, request
from dotenv import load_dotenv

from .aqi_client import AQIClient
from .data_store import DataStore

# 載入環境變數
load_dotenv()

IS_DEBUG = os.getenv("DEBUG", "false").lower() == "true"

# 設定日誌
logging.basicConfig(
    level=logging.DEBUG if IS_DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# 初始化 Flask
app = Flask(
    __name__,
    template_folder="../templates",
    static_folder="../static"
)


# 初始化客戶端和資料儲存
aqi_client = AQIClient(api_key=os.getenv("MOENV_API_KEY"))
data_store = DataStore(data_dir=Path(__file__).parent.parent / "data")

# 預設測站
DEFAULT_STATION = os.getenv("DEFAULT_STATION", "板橋")

# 常數定義 (L02: 消除魔術數字)
MAX_HISTORY_HOURS = 168  # 7 天
DEFAULT_HISTORY_HOURS = 24


# ============================================================
# H06: 統一錯誤處理器
# ============================================================
@app.errorhandler(Exception)
def handle_exception(e):
    """全域錯誤處理器 - 避免洩露內部資訊"""
    logger.error(f"Unhandled exception: {e}", exc_info=True)

    if IS_DEBUG:
        # 開發環境顯示詳細錯誤
        return jsonify({
            "success": False,
            "error": str(e),
            "type": type(e).__name__
        }), 500
    else:
        # 生產環境隱藏細節
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


# ============================================================
# 路由
# ============================================================
@app.route("/")
def index():
    """主頁面"""
    return render_template("index.html", default_station=DEFAULT_STATION)


@app.route("/favicon.ico")
def favicon():
    """Favicon - 返回空響應避免 404/500"""
    return "", 204


@app.route("/api/stations")
def get_stations():
    """取得所有測站列表"""
    try:
        data = aqi_client.fetch_all_stations()
        if data:
            stations = [
                {
                    "name": r["sitename"],
                    "county": r["county"],
                    "siteid": r["siteid"]
                }
                for r in data
            ]
            # 依縣市分組
            grouped = {}
            for s in stations:
                county = s["county"]
                if county not in grouped:
                    grouped[county] = []
                grouped[county].append(s)
            return jsonify({"success": True, "stations": grouped})
        return jsonify({"success": False, "error": "無法取得測站資料"})
    except Exception as e:
        logger.error(f"取得測站列表失敗: {e}")
        raise  # 交給全域錯誤處理器


@app.route("/api/aqi")
def get_aqi():
    """取得指定測站的 AQI 資料"""
    station = request.args.get("station", DEFAULT_STATION)

    try:
        data = aqi_client.fetch_station(station)
        if data:
            # 儲存到歷史資料
            data_store.append(station, data)

            return jsonify({
                "success": True,
                "data": data,
                "timestamp": datetime.now(TW_TZ).isoformat()
            })
        return jsonify({"success": False, "error": f"找不到測站: {station}"})
    except Exception as e:
        logger.error(f"取得 AQI 資料失敗: {e}")
        raise


@app.route("/api/history")
def get_history():
    """取得過去 24 小時的歷史資料"""
    station = request.args.get("station", DEFAULT_STATION)

    # H05: 安全的參數解析
    try:
        hours = int(request.args.get("hours", DEFAULT_HISTORY_HOURS))
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid hours parameter"}), 400

    # 範圍驗證
    if hours < 1 or hours > MAX_HISTORY_HOURS:
        return jsonify({
            "success": False,
            "error": f"Hours must be between 1 and {MAX_HISTORY_HOURS}"
        }), 400

    try:
        history = data_store.get_history(station, hours)

        # 如果歷史資料不足，用模擬資料填充
        if len(history) < hours:
            current = aqi_client.fetch_station(station)
            if current:
                history = data_store.fill_with_mock(station, current, hours)

        return jsonify({
            "success": True,
            "station": station,
            "data": history,
            "count": len(history)
        })
    except Exception as e:
        logger.error(f"取得歷史資料失敗: {e}")
        raise


@app.route("/api/health")
def health_check():
    """健康檢查"""
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now(TW_TZ).isoformat(),
        "has_api_key": bool(os.getenv("MOENV_API_KEY"))
    })


def create_app():
    """應用程式工廠"""
    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=IS_DEBUG)
