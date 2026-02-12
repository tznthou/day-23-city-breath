"""
環境部 AQI API 客戶端

資料來源：環境部環境資料開放平臺
授權條款：CC BY 4.0
https://data.moenv.gov.tw
"""

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
import requests
import urllib3

# 台灣時區 (UTC+8)
TW_TZ = timezone(timedelta(hours=8))

# 抑制 SSL 警告（環境部 API 憑證問題 - 見 C01 說明）
# 注意：政府伺服器憑證有 "Missing Subject Key Identifier" 問題
# 這是外部問題，無法在本專案修復
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

# API 設定
API_BASE_URL = "https://data.moenv.gov.tw/api/v2/aqx_p_432"
REQUEST_TIMEOUT = 10  # 秒
CACHE_TTL = 300  # 快取有效時間（秒）- 環境部資料每小時更新，5 分鐘夠用


class AQIClient:
    """環境部 AQI API 客戶端"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        # M02: 快取機制
        self._cache = {}
        self._cache_time = {}

    def fetch_all_stations(self) -> Optional[list]:
        """取得所有測站的即時 AQI 資料（帶快取）"""
        cache_key = "all_stations"

        # M02: 檢查快取
        if cache_key in self._cache:
            cached_time = self._cache_time.get(cache_key, 0)
            if time.time() - cached_time < CACHE_TTL:
                logger.debug("使用快取的測站資料")
                return self._cache[cache_key]

        # 無 API Key 時使用模擬資料
        if not self.api_key:
            logger.warning("未設定 API Key，使用模擬資料")
            mock_data = self._get_mock_data()
            self._cache[cache_key] = mock_data
            self._cache_time[cache_key] = time.time()
            return mock_data

        try:
            params = {
                "api_key": self.api_key,
                "format": "json",
                "limit": 100
            }
            response = requests.get(
                API_BASE_URL,
                params=params,
                timeout=REQUEST_TIMEOUT,
                verify=False  # 環境部 API SSL 憑證問題（見 C01）
            )
            response.raise_for_status()

            # M05: 安全的 JSON 解析
            content_type = response.headers.get('Content-Type', '')
            if 'application/json' not in content_type and 'text/json' not in content_type:
                logger.error(f"非預期的 Content-Type: {content_type}")
                logger.debug(f"回應內容: {response.text[:200]}")
                return self._get_cached_or_none(cache_key)

            try:
                data = response.json()
            except json.JSONDecodeError as e:
                logger.error(f"JSON 解析失敗: {e}")
                logger.debug(f"回應內容: {response.text[:500]}")
                return self._get_cached_or_none(cache_key)

            # 環境部 API v2 回傳格式：直接回傳 list 或包在 {"records": [...]}
            if isinstance(data, list):
                records = data
            elif isinstance(data, dict) and "records" in data:
                records = data["records"]
            else:
                logger.error(f"非預期的 API 回應格式: {type(data).__name__}")
                return self._get_cached_or_none(cache_key)

            # 更新快取
            self._cache[cache_key] = records
            self._cache_time[cache_key] = time.time()
            logger.info(f"成功取得 {len(records)} 個測站資料")
            return records

        except requests.Timeout:
            logger.error(f"API 請求超時 ({REQUEST_TIMEOUT}s)")
            return self._get_cached_or_none(cache_key)
        except requests.HTTPError as e:
            logger.error(f"HTTP 錯誤 {e.response.status_code}: {e}")
            return self._get_cached_or_none(cache_key)
        except requests.RequestException as e:
            logger.error(f"API 請求失敗: {e}")
            return self._get_cached_or_none(cache_key)

    def _get_cached_or_none(self, cache_key: str) -> Optional[list]:
        """
        M02: 請求失敗時返回過期快取（如果有）
        這樣即使 API 暫時不可用，使用者仍能看到舊資料
        """
        if cache_key in self._cache:
            logger.warning("API 請求失敗，返回過期快取")
            return self._cache[cache_key]
        return None

    def clear_cache(self) -> None:
        """清除快取（測試用）"""
        self._cache.clear()
        self._cache_time.clear()
        logger.debug("快取已清除")

    def fetch_station(self, station_name: str) -> Optional[dict]:
        """取得指定測站的 AQI 資料"""
        all_data = self.fetch_all_stations()
        if not all_data:
            return None

        # 尋找指定測站
        for record in all_data:
            if record.get("sitename") == station_name:
                return self._normalize_record(record)

        # 模糊匹配
        for record in all_data:
            if station_name in record.get("sitename", ""):
                return self._normalize_record(record)

        logger.warning(f"找不到測站: {station_name}")
        return None

    def _normalize_record(self, record: dict) -> dict:
        """標準化資料格式"""
        def safe_float(val, default=0.0):
            try:
                return float(val) if val and val != "" else default
            except (ValueError, TypeError):
                return default

        def safe_int(val, default=0):
            try:
                return int(val) if val and val != "" else default
            except (ValueError, TypeError):
                return default

        return {
            "sitename": record.get("sitename", ""),
            "county": record.get("county", ""),
            "aqi": safe_int(record.get("aqi")),
            "status": record.get("status", ""),
            "pollutant": record.get("pollutant", ""),
            "pm25": safe_float(record.get("pm2.5")),
            "pm25_avg": safe_float(record.get("pm2.5_avg")),
            "pm10": safe_float(record.get("pm10")),
            "o3": safe_float(record.get("o3")),
            "o3_8hr": safe_float(record.get("o3_8hr")),
            "co": safe_float(record.get("co")),
            "so2": safe_float(record.get("so2")),
            "no2": safe_float(record.get("no2")),
            "wind_speed": safe_float(record.get("wind_speed")),
            "wind_direc": safe_float(record.get("wind_direc")),
            "publishtime": record.get("publishtime", ""),
            "longitude": safe_float(record.get("longitude")),
            "latitude": safe_float(record.get("latitude")),
        }

    def _get_mock_data(self) -> list:
        """模擬資料（無 API Key 時使用）"""
        import random

        mock_stations = [
            ("臺北", "臺北市"),
            ("板橋", "新北市"),
            ("桃園", "桃園市"),
            ("臺中", "臺中市"),
            ("臺南", "臺南市"),
            ("高雄", "高雄市"),
        ]

        records = []
        for name, county in mock_stations:
            aqi = random.randint(20, 150)
            records.append({
                "sitename": name,
                "county": county,
                "aqi": str(aqi),
                "status": self._aqi_to_status(aqi),
                "pollutant": "細懸浮微粒",
                "pm2.5": str(random.randint(5, 50)),
                "pm2.5_avg": str(random.randint(10, 40)),
                "pm10": str(random.randint(10, 80)),
                "o3": str(random.randint(10, 60)),
                "o3_8hr": str(random.randint(15, 50)),
                "co": str(round(random.uniform(0.1, 0.5), 2)),
                "so2": str(round(random.uniform(0.5, 3), 1)),
                "no2": str(random.randint(3, 20)),
                "wind_speed": str(round(random.uniform(0.5, 5), 1)),
                "wind_direc": str(random.randint(0, 360)),
                "publishtime": datetime.now(TW_TZ).strftime("%Y/%m/%d %H:00:00"),
                "longitude": "121.5",
                "latitude": "25.0",
            })
        return records

    @staticmethod
    def _aqi_to_status(aqi: int) -> str:
        """AQI 轉狀態文字"""
        if aqi <= 50:
            return "良好"
        elif aqi <= 100:
            return "普通"
        elif aqi <= 150:
            return "對敏感族群不健康"
        elif aqi <= 200:
            return "對所有族群不健康"
        elif aqi <= 300:
            return "非常不健康"
        else:
            return "危害"
