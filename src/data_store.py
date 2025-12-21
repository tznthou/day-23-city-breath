"""
歷史資料儲存模組
用於累積過去 24 小時的 AQI 資料
"""

import json
import logging
import os
import random
import re
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 設定
MAX_HISTORY_HOURS = 168  # 最多保留 7 天
HISTORY_FILE_PATTERN = "{station}_history.json"

# H03: 測站名稱驗證正則（允許中文、英文、數字、括號、空格、底線、連字號）
STATION_NAME_PATTERN = re.compile(r'^[\u4e00-\u9fff\w\s\-（）\(\)]{1,50}$')


class DataStore:
    """歷史資料儲存"""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir).resolve()  # 使用絕對路徑
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # 建立 .gitkeep
        gitkeep = self.data_dir / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.touch()

    def _validate_station_name(self, station: str) -> str:
        """
        H03: 驗證並清理測站名稱
        防止 Path Traversal 攻擊
        """
        if not station or not isinstance(station, str):
            raise ValueError("Station name is required")

        # 去除前後空白
        station = station.strip()

        # 長度檢查
        if len(station) > 50:
            raise ValueError("Station name too long")

        # 禁止路徑遍歷字元
        if ".." in station or "/" in station or "\\" in station:
            raise ValueError("Invalid characters in station name")

        # 正則驗證
        if not STATION_NAME_PATTERN.match(station):
            raise ValueError(f"Invalid station name format: {station}")

        return station

    def _get_file_path(self, station: str) -> Path:
        """
        取得測站的歷史資料檔案路徑（安全版本）
        H03: 防止 Path Traversal
        """
        # 驗證測站名稱
        safe_station = self._validate_station_name(station)

        # 產生安全的檔案名稱（替換不安全字元）
        safe_name = re.sub(r'[^\u4e00-\u9fff\w\-]', '_', safe_station)

        # 計算檔案路徑
        file_path = (self.data_dir / HISTORY_FILE_PATTERN.format(station=safe_name)).resolve()

        # 確保路徑在 data_dir 內（防止路徑遍歷）
        if not str(file_path).startswith(str(self.data_dir)):
            raise ValueError("Path traversal attempt detected")

        return file_path

    def append(self, station: str, data: dict) -> None:
        """新增一筆資料"""
        try:
            file_path = self._get_file_path(station)
        except ValueError as e:
            logger.warning(f"無效的測站名稱: {station} - {e}")
            return

        # 讀取現有資料
        history = self._load_history(file_path)

        # 新增資料（加上時間戳）
        entry = {
            **data,
            "recorded_at": datetime.now().isoformat()
        }

        # 檢查是否已有相同時間的資料
        publish_time = data.get("publishtime", "")
        for h in history:
            if h.get("publishtime") == publish_time:
                logger.debug(f"跳過重複資料: {publish_time}")
                return

        history.append(entry)

        # 只保留最近 N 小時
        cutoff = datetime.now() - timedelta(hours=MAX_HISTORY_HOURS)
        history = [
            h for h in history
            if self._parse_time(h.get("recorded_at", "")) > cutoff
        ]

        # 依時間排序（新的在後）
        history.sort(key=lambda x: x.get("recorded_at", ""))

        # 儲存（原子性寫入）
        self._save_history(file_path, history)
        logger.debug(f"已儲存 {station} 資料，共 {len(history)} 筆")

    def get_history(self, station: str, hours: int = 24) -> list:
        """取得過去 N 小時的歷史資料"""
        try:
            file_path = self._get_file_path(station)
        except ValueError as e:
            logger.warning(f"無效的測站名稱: {station} - {e}")
            return []

        history = self._load_history(file_path)

        # 過濾時間範圍
        cutoff = datetime.now() - timedelta(hours=hours)
        filtered = [
            h for h in history
            if self._parse_time(h.get("recorded_at", "")) > cutoff
        ]

        # 依時間排序（舊的在前，新的在後）
        filtered.sort(key=lambda x: x.get("recorded_at", ""))

        return filtered

    def fill_with_mock(self, station: str, current: dict, hours: int = 24) -> list:
        """用模擬資料填充不足的歷史資料"""
        history = self.get_history(station, hours)
        existing_count = len(history)

        if existing_count >= hours:
            return history[-hours:]

        # 產生模擬資料
        mock_data = []
        base_aqi = current.get("aqi", 50)
        base_pm25 = current.get("pm25", 15)

        for i in range(hours - existing_count):
            # 從過去往現在填充
            hours_ago = hours - existing_count - i
            timestamp = datetime.now() - timedelta(hours=hours_ago)

            # 模擬 AQI 波動（基於當前值 ±30%）
            variation = random.uniform(-0.3, 0.3)
            mock_aqi = max(0, min(500, int(base_aqi * (1 + variation))))
            mock_pm25 = max(0, base_pm25 * (1 + variation * 0.8))

            mock_entry = {
                **current,
                "aqi": mock_aqi,
                "pm25": round(mock_pm25, 1),
                "publishtime": timestamp.strftime("%Y/%m/%d %H:00:00"),
                "recorded_at": timestamp.isoformat(),
                "is_mock": True
            }
            mock_data.append(mock_entry)

        # 合併：模擬資料 + 真實資料
        combined = mock_data + history

        # 依時間排序
        combined.sort(key=lambda x: x.get("recorded_at", ""))

        return combined[-hours:]

    def _load_history(self, file_path: Path) -> list:
        """載入歷史資料"""
        if not file_path.exists():
            return []
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # M04: 驗證資料格式
                if not isinstance(data, list):
                    logger.error(f"歷史資料格式錯誤，預期 list 但得到 {type(data)}")
                    return []
                return data
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"載入歷史資料失敗: {e}")
            return []

    def _save_history(self, file_path: Path, history: list) -> None:
        """
        M04: 原子性儲存歷史資料
        使用臨時檔案 + 移動的方式確保寫入完整性
        """
        temp_fd = None
        temp_path = None

        try:
            # 1. 先寫入臨時檔案
            temp_fd, temp_path = tempfile.mkstemp(
                dir=file_path.parent,
                prefix=f".{file_path.name}_",
                suffix=".tmp"
            )

            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
                temp_fd = None  # fdopen 已經接管 fd

            # 2. 驗證寫入的資料
            with open(temp_path, 'r', encoding='utf-8') as f:
                json.load(f)  # 確保可以解析

            # 3. 原子性替換（move 在同一檔案系統上是原子操作）
            shutil.move(temp_path, file_path)
            temp_path = None  # 已移動成功

        except Exception as e:
            logger.error(f"儲存歷史資料失敗: {e}")

            # 清理臨時檔案
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

            # 清理未關閉的 fd
            if temp_fd is not None:
                try:
                    os.close(temp_fd)
                except OSError:
                    pass

    @staticmethod
    def _parse_time(time_str: str) -> datetime:
        """解析時間字串"""
        if not time_str:
            return datetime.min
        try:
            return datetime.fromisoformat(time_str)
        except ValueError:
            try:
                return datetime.strptime(time_str, "%Y/%m/%d %H:%M:%S")
            except ValueError:
                return datetime.min
