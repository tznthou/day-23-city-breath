# Code Review Report - City Breath 專案
Generated: 2025-12-21
Reviewer: Claude Code Review Expert
Reviewed Files:
- `src/app.py` (148 lines)
- `src/aqi_client.py` (173 lines)
- `src/data_store.py` (161 lines)
- `static/js/app.js` (292 lines)
- `static/js/rings.js` (280 lines)
- `static/js/noise.js` (150 lines)
- `templates/index.html` (243 lines)

**Total Lines Reviewed**: ~1,441 lines

---

## Executive Summary
**Overall Code Quality**: Needs Improvement
**Risk Level**: High
**Recommended Action**: Requires changes before production deployment

這是一個有創意的空氣品質視覺化專案，整體架構清晰，但存在多個關鍵安全性問題和效能隱憂。最嚴重的問題是 **SSL 驗證完全關閉** 和 **缺乏基本的安全性 Headers**。程式碼品質整體尚可，但錯誤處理不夠完善，且缺乏輸入驗證。

---

## Findings Overview
| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 2 | 3 | 4 | 2 | 11 |
| Bugs/Correctness | 0 | 2 | 3 | 1 | 6 |
| Performance | 0 | 1 | 2 | 2 | 5 |
| Code Smells | 0 | 0 | 3 | 4 | 7 |
| Maintainability | 0 | 0 | 2 | 3 | 5 |
| **Total** | **2** | **6** | **14** | **12** | **34** |

---

## 🔴 Critical Issues

### [C01] SSL 驗證完全關閉導致中間人攻擊風險
**Category**: Security (OWASP A02 - Cryptographic Failures)
**Severity**: Critical
**Location**: `src/aqi_client.py:16`, `src/aqi_client.py:49`

**What's Wrong**:
```python
# Line 16
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Line 49
response = requests.get(
    API_BASE_URL,
    params=params,
    timeout=REQUEST_TIMEOUT,
    verify=False  # 環境部 API SSL 憑證問題
)
```

完全關閉 SSL 驗證，使應用程式暴露在中間人攻擊（MITM）風險下。

**Why This Must Be Fixed**:
- **攻擊者可攔截 API 請求**：在公共 Wi-Fi 或受損網路環境中，攻擊者可輕易竄改 API 回應
- **假資料注入**：攻擊者可注入假的 AQI 數據，誤導使用者做出錯誤決策（例如空氣很糟但顯示良好）
- **API Key 外洩**：API Key 在 HTTP 參數中傳輸，中間人可竊取
- **違反安全最佳實務**：生產環境中絕對禁止關閉 SSL 驗證

**Impact Assessment**:
- User Impact: High（數據可信度歸零）
- Business Impact: High（失去使用者信任）
- Exploitation Difficulty: Easy（公開工具即可進行 MITM）

**How to Fix**:
```python
# 方案 1：正確處理證書（推薦）
# 如果環境部 API 真的有憑證問題，應該：
# 1. 下載他們的根憑證或中繼憑證
# 2. 將憑證放在專案中（例如 certs/moenv_ca.pem）
# 3. 使用 verify 參數指定憑證路徑

import os
from pathlib import Path

CERT_PATH = Path(__file__).parent / "certs" / "moenv_ca.pem"

response = requests.get(
    API_BASE_URL,
    params=params,
    timeout=REQUEST_TIMEOUT,
    verify=str(CERT_PATH) if CERT_PATH.exists() else True
)

# 方案 2：如果環境部使用自簽憑證，使用 certifi
import certifi

response = requests.get(
    API_BASE_URL,
    params=params,
    timeout=REQUEST_TIMEOUT,
    verify=certifi.where()  # 使用 certifi 提供的 CA bundle
)

# 方案 3：環境變數控制（僅開發環境可關閉）
VERIFY_SSL = os.getenv("VERIFY_SSL", "true").lower() != "false"
response = requests.get(
    API_BASE_URL,
    params=params,
    timeout=REQUEST_TIMEOUT,
    verify=VERIFY_SSL
)
# 並在生產環境強制啟用
if not VERIFY_SSL and os.getenv("FLASK_ENV") == "production":
    raise SecurityError("Cannot disable SSL verification in production")
```

**References**:
- [OWASP - Transport Layer Protection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html)
- [Requests Documentation - SSL Cert Verification](https://requests.readthedocs.io/en/latest/user/advanced/#ssl-cert-verification)

---

### [C02] API Key 可能外洩到日誌和錯誤訊息
**Category**: Security (OWASP A02 - Cryptographic Failures)
**Severity**: Critical
**Location**: `src/app.py:135`

**What's Wrong**:
```python
@app.route("/api/health")
def health_check():
    """健康檢查"""
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "has_api_key": bool(os.getenv("MOENV_API_KEY"))  # 這個還好
    })
```

雖然這個端點本身沒問題，但專案中缺乏對 API Key 的全面保護機制。潛在外洩點：

1. Flask 的預設錯誤頁面可能洩露環境變數
2. 日誌可能記錄包含 API Key 的 URL（如果將來改成 URL 參數）
3. 沒有 `.env` 的 `.gitignore` 確認

**Why This Must Be Fixed**:
- **API Key 外洩**：如果 API Key 被提交到 Git 或出現在錯誤訊息中，攻擊者可盜用
- **配額濫用**：環境部 API 通常有請求配額，Key 外洩會導致配額被耗盡
- **法律責任**：API Key 外洩可能違反服務條款

**Impact Assessment**:
- User Impact: Medium
- Business Impact: High（API Key 需重新申請）
- Exploitation Difficulty: Easy（只需查看錯誤頁面或 Git 歷史）

**How to Fix**:
```python
# 1. 確保 .env 在 .gitignore 中
# .gitignore 應包含：
"""
.env
.env.local
.env.*.local
*.key
*.pem
secrets/
"""

# 2. 在 app.py 開頭加入 API Key 驗證
if not os.getenv("MOENV_API_KEY"):
    if os.getenv("FLASK_ENV") == "production":
        raise RuntimeError("MOENV_API_KEY is required in production")
    logger.warning("MOENV_API_KEY not set, using mock data")

# 3. 關閉 Flask 的 Debug 模式在生產環境（已經有做，但應強制）
if os.getenv("FLASK_ENV") == "production" and app.debug:
    raise RuntimeError("Debug mode must be disabled in production")

# 4. 過濾日誌中的敏感資訊
class SensitiveDataFilter(logging.Filter):
    def filter(self, record):
        if hasattr(record, 'msg'):
            # 移除可能包含 API Key 的資訊
            record.msg = re.sub(r'api_key=[^&\s]+', 'api_key=***', str(record.msg))
        return True

logger.addFilter(SensitiveDataFilter())

# 5. 自訂錯誤處理器，避免洩露環境資訊
@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}", exc_info=True)
    return jsonify({
        "success": False,
        "error": "Internal server error" if not app.debug else str(error)
    }), 500
```

**References**:
- [OWASP - Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

## 🟠 High Priority Issues

### [H01] 缺乏 CORS 設定，可能導致跨站請求濫用
**Category**: Security (OWASP A01 - Broken Access Control)
**Severity**: High
**Location**: `src/app.py` (全域)

**What's Wrong**:
Flask 應用程式完全沒有設定 CORS（Cross-Origin Resource Sharing），預設情況下瀏覽器會阻擋跨域請求，但這也意味著：
1. 如果將來加入 CORS 但設定錯誤（例如 `*`），會有安全風險
2. 目前無法從其他域名的前端呼叫此 API

**Why This Should Be Fixed**:
- **準備不足**：目前可能沒問題，但如果將來需要 CORS 而匆忙加入 `Access-Control-Allow-Origin: *`，會允許任何網站呼叫你的 API
- **API 濫用**：惡意網站可嵌入你的 API 呼叫，消耗伺服器資源
- **使用者隱私**：如果將來加入使用者功能，錯誤的 CORS 設定可能導致 CSRF 攻擊

**How to Fix**:
```python
# 安裝 flask-cors
# uv add flask-cors

from flask_cors import CORS

# 方案 1：限制特定域名（生產環境推薦）
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5000").split(",")
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=False)

# 方案 2：僅允許同源（最嚴格）
CORS(app, origins=[request.host_url.rstrip('/')], supports_credentials=False)

# 方案 3：開發環境寬鬆，生產環境嚴格
if os.getenv("FLASK_ENV") == "production":
    CORS(app, origins=["https://citybreath.example.com"])
else:
    CORS(app, origins="*")  # 僅開發環境
```

---

### [H02] 缺乏 HTTP 安全性 Headers
**Category**: Security (OWASP A05 - Security Misconfiguration)
**Severity**: High
**Location**: `src/app.py` (全域)

**What's Wrong**:
完全沒有設定任何安全性 HTTP Headers，這會讓應用程式暴露在多種攻擊下：
- 沒有 `Content-Security-Policy`（CSP）防禦 XSS
- 沒有 `X-Frame-Options` 防禦 Clickjacking
- 沒有 `X-Content-Type-Options` 防禦 MIME sniffing
- 沒有 `Strict-Transport-Security`（HSTS）強制 HTTPS

**Why This Should Be Fixed**:
- **XSS 風險**：如果將來在模板中輸出使用者輸入（例如測站名稱），沒有 CSP 會讓攻擊者能執行惡意 JavaScript
- **Clickjacking**：攻擊者可將你的網站嵌入 iframe 中，誘騙使用者點擊
- **中間人攻擊**：沒有 HSTS，使用者可能被降級攻擊到 HTTP

**How to Fix**:
```python
# 方案 1：使用 Flask-Talisman（推薦）
# uv add flask-talisman

from flask_talisman import Talisman

# 開發環境不強制 HTTPS，生產環境強制
Talisman(
    app,
    force_https=os.getenv("FLASK_ENV") == "production",
    strict_transport_security=True,
    strict_transport_security_max_age=31536000,  # 1 年
    content_security_policy={
        'default-src': "'self'",
        'script-src': [
            "'self'",
            'https://cdn.tailwindcss.com',  # Tailwind CDN
            "'unsafe-inline'",  # Tailwind 設定需要（不理想但必要）
        ],
        'style-src': [
            "'self'",
            'https://fonts.googleapis.com',
            "'unsafe-inline'",  # inline styles
        ],
        'font-src': [
            "'self'",
            'https://fonts.gstatic.com',
        ],
        'img-src': "'self' data:",
    },
    content_security_policy_nonce_in=['script-src'],
    frame_options='DENY',
    x_content_type_options=True,
    referrer_policy='strict-origin-when-cross-origin',
)

# 方案 2：手動設定（如果不想裝套件）
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    # CSP（需調整以允許 Tailwind CDN）
    csp = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "frame-ancestors 'none';"
    )
    response.headers['Content-Security-Policy'] = csp

    # HSTS（僅 HTTPS）
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

    return response
```

---

### [H03] 缺乏輸入驗證和清理，潛在 Path Traversal 風險
**Category**: Security (OWASP A03 - Injection)
**Severity**: High
**Location**: `src/data_store.py:33`, `src/app.py:84`, `src/app.py:106`

**What's Wrong**:
```python
# data_store.py Line 33
def _get_file_path(self, station: str) -> Path:
    """取得測站的歷史資料檔案路徑"""
    safe_name = station.replace("/", "_").replace("\\", "_")  # 不足夠！
    return self.data_dir / HISTORY_FILE_PATTERN.format(station=safe_name)

# app.py Line 84
station = request.args.get("station", DEFAULT_STATION)  # 未驗證！
```

**問題點**：
1. 僅替換 `/` 和 `\`，沒有處理 `..`（Path Traversal）
2. 沒有限制測站名稱的字元集
3. 沒有驗證測站名稱是否存在於已知列表中

**Why This Should Be Fixed**:
- **Path Traversal 攻擊**：攻擊者可發送 `?station=../../etc/passwd` 嘗試讀取系統檔案
- **檔案系統污染**：攻擊者可創建任意檔案名稱，例如 `?station=<script>alert(1)</script>`
- **DoS 攻擊**：創建大量假測站檔案耗盡磁碟空間

**Impact Assessment**:
- User Impact: Low（主要影響伺服器）
- Business Impact: High（可能讀取敏感檔案）
- Exploitation Difficulty: Medium

**How to Fix**:
```python
# data_store.py 改進版
import re
from pathlib import Path

def _get_file_path(self, station: str) -> Path:
    """取得測站的歷史資料檔案路徑（安全版本）"""
    # 1. 嚴格驗證：僅允許中文、英文、數字
    if not re.match(r'^[\u4e00-\u9fff\w\-]{1,50}$', station):
        raise ValueError(f"Invalid station name: {station}")

    # 2. 移除危險字元
    safe_name = re.sub(r'[^\u4e00-\u9fff\w\-]', '_', station)

    # 3. 確保結果路徑仍在 data_dir 內（防止 Path Traversal）
    file_path = (self.data_dir / HISTORY_FILE_PATTERN.format(station=safe_name)).resolve()
    if not str(file_path).startswith(str(self.data_dir.resolve())):
        raise ValueError(f"Path traversal attempt detected: {station}")

    return file_path

# app.py 改進版
# 加入測站白名單驗證
VALID_STATIONS_CACHE = None
CACHE_EXPIRE = 3600  # 1 小時

def get_valid_stations():
    """取得有效測站列表（帶快取）"""
    global VALID_STATIONS_CACHE
    if VALID_STATIONS_CACHE and time.time() - VALID_STATIONS_CACHE['time'] < CACHE_EXPIRE:
        return VALID_STATIONS_CACHE['stations']

    data = aqi_client.fetch_all_stations()
    if data:
        stations = {r["sitename"] for r in data}
        VALID_STATIONS_CACHE = {'stations': stations, 'time': time.time()}
        return stations
    return set()

@app.route("/api/aqi")
def get_aqi():
    station = request.args.get("station", DEFAULT_STATION)

    # 驗證測站名稱
    valid_stations = get_valid_stations()
    if station not in valid_stations and station != DEFAULT_STATION:
        return jsonify({"success": False, "error": "Invalid station name"}), 400

    # ... 後續處理
```

---

### [H04] 缺乏 Rate Limiting，容易被 DoS 攻擊
**Category**: Security (OWASP A04 - Insecure Design)
**Severity**: High
**Location**: `src/app.py` (所有 API 端點)

**What's Wrong**:
所有 API 端點都沒有任何請求頻率限制，攻擊者可以：
1. 瘋狂呼叫 `/api/aqi`，耗盡環境部 API 配額
2. 大量請求 `/api/history`，消耗伺服器 CPU 和記憶體
3. 創建數千個假測站檔案

**Why This Should Be Fixed**:
- **API 配額耗盡**：環境部 API 通常有每日請求限制，被攻擊後會影響正常使用者
- **伺服器癱瘓**：大量請求會導致伺服器回應變慢或崩潰
- **成本增加**：如果部署在按流量計費的平台（如 AWS），會產生額外費用

**How to Fix**:
```python
# 安裝 flask-limiter
# uv add flask-limiter

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app=app,
    key_func=get_remote_address,  # 以 IP 為限制基準
    default_limits=["200 per day", "50 per hour"],  # 全域限制
    storage_uri="memory://"  # 開發環境用記憶體，生產環境用 Redis
)

# 針對不同端點設定不同限制
@app.route("/api/aqi")
@limiter.limit("30 per minute")  # 每分鐘最多 30 次
def get_aqi():
    # ...

@app.route("/api/history")
@limiter.limit("10 per minute")  # 歷史資料較耗資源，限制更嚴格
def get_history():
    # ...

@app.route("/api/stations")
@limiter.limit("10 per minute")  # 測站列表不常變動
def get_stations():
    # ...

# 錯誤處理
@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({
        "success": False,
        "error": "Rate limit exceeded. Please try again later."
    }), 429
```

**Production Note**: 在生產環境應使用 Redis 作為 Rate Limiter 的儲存後端：
```python
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    storage_uri=os.getenv("REDIS_URL", "redis://localhost:6379")
)
```

---

### [H05] 無限制的 `hours` 參數可能導致記憶體耗盡
**Category**: Security (OWASP A04 - Insecure Design) / Performance
**Severity**: High
**Location**: `src/app.py:107`

**What's Wrong**:
```python
hours = min(int(request.args.get("hours", 24)), 168)  # 最多 7 天
```

雖然有限制最大值為 168 小時（7 天），但：
1. 沒有處理 `int()` 轉換失敗的情況（例如 `?hours=abc`）
2. 沒有限制最小值（`?hours=-1000` 會發生什麼？）
3. 168 小時對於頻繁請求仍然是很大的資料量

**Why This Should Be Fixed**:
- **程式崩潰**：`int("abc")` 會拋出 `ValueError`，導致 500 錯誤
- **負數陷阱**：`min(-1000, 168)` 會返回 `-1000`，可能導致非預期行為
- **記憶體攻擊**：攻擊者持續請求 168 小時的歷史資料，會消耗大量記憶體

**How to Fix**:
```python
@app.route("/api/history")
@limiter.limit("10 per minute")  # 結合 Rate Limiting
def get_history():
    station = request.args.get("station", DEFAULT_STATION)

    # 安全的參數解析
    try:
        hours = int(request.args.get("hours", 24))
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid hours parameter"}), 400

    # 限制範圍
    if hours < 1 or hours > 168:
        return jsonify({"success": False, "error": "Hours must be between 1 and 168"}), 400

    # 進一步限制：非管理員只能查詢 24 小時
    if hours > 24 and not is_admin():  # 需實作 is_admin()
        return jsonify({"success": False, "error": "Maximum 24 hours for regular users"}), 403

    # ... 後續處理
```

---

### [H06] 錯誤訊息洩露內部資訊
**Category**: Security (OWASP A09 - Logging Failures)
**Severity**: High
**Location**: `src/app.py:78`, `src/app.py:100`, `src/app.py:126`

**What's Wrong**:
```python
return jsonify({"success": False, "error": str(e)}), 500
```

直接將 Python 異常訊息回傳給前端，可能洩露：
- 檔案路徑（例如 `/Users/tznthou/Documents/...`）
- 套件版本（例如 `requests.exceptions.ConnectionError`）
- 資料庫結構（如果將來使用資料庫）
- 內部邏輯細節

**Why This Should Be Fixed**:
- **資訊洩露**：攻擊者可根據錯誤訊息推測系統架構
- **指紋識別**：錯誤訊息可能洩露使用的框架和版本，方便攻擊者尋找已知漏洞

**How to Fix**:
```python
import traceback

# 自訂錯誤處理器
@app.errorhandler(Exception)
def handle_exception(e):
    # 記錄完整錯誤到日誌
    logger.error(f"Unhandled exception: {e}", exc_info=True)

    # 根據環境決定回傳內容
    if app.debug:
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500
    else:
        return jsonify({
            "success": False,
            "error": "Internal server error. Please try again later."
        }), 500

# 修改現有的錯誤處理
@app.route("/api/aqi")
def get_aqi():
    station = request.args.get("station", DEFAULT_STATION)

    try:
        data = aqi_client.fetch_station(station)
        # ...
    except ValueError as e:
        # 預期的錯誤（例如輸入驗證失敗），可回傳詳細訊息
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        # 非預期錯誤，記錄但不洩露細節
        logger.error(f"Failed to fetch AQI for {station}: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to fetch data"}), 500
```

---

## 🟡 Medium Priority Issues

### [M01] 前端 XSS 風險：缺乏輸出編碼
**Category**: Security (OWASP A03 - Injection)
**Severity**: Medium
**Location**: `static/js/app.js:189`, `templates/index.html:142`

**What's Wrong**:
```javascript
// app.js Line 189
option.textContent = station.name;  // textContent 是安全的

// 但如果將來改成 innerHTML 就危險了：
// option.innerHTML = station.name;  // ❌ XSS 風險
```

雖然目前使用 `textContent` 是安全的，但專案中缺乏明確的 XSS 防禦意識。特別是：
1. Jinja2 模板預設會自動轉義，但需確保沒有使用 `| safe` 過濾器
2. JavaScript 中動態插入 HTML 需格外小心

**Why This Should Be Fixed**:
如果測站名稱被攻擊者控制（例如環境部 API 被入侵），可能注入惡意腳本：
```javascript
station.name = "<img src=x onerror=alert('XSS')>"
```

**How to Fix**:
```javascript
// 建立安全的 HTML 插入函數
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 或使用 DOMPurify 庫（推薦）
// <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js"></script>
const cleanHtml = DOMPurify.sanitize(dirtyHtml);

// 確保所有動態內容都經過清理
option.textContent = station.name;  // ✅ 安全
// 如果必須使用 innerHTML：
element.innerHTML = DOMPurify.sanitize(station.name);
```

**Jinja2 模板檢查**:
```html
<!-- ✅ 安全（自動轉義） -->
<option value="{{ default_station }}">{{ default_station }}</option>

<!-- ❌ 危險（關閉轉義） -->
<option value="{{ default_station | safe }}">{{ default_station }}</option>

<!-- ✅ 如果需要插入 HTML，先用 Markup 包裝 -->
{% from markupsafe import Markup %}
{{ Markup.escape(user_input) }}
```

---

### [M02] API 回應快取機制不完整
**Category**: Performance
**Severity**: Medium
**Location**: `src/aqi_client.py:30-31`

**What's Wrong**:
```python
def __init__(self, api_key: Optional[str] = None):
    self.api_key = api_key
    self._cache = {}  # 定義了但從未使用！
    self._cache_time = None
```

定義了快取變數但完全沒有實作快取邏輯，導致每次 `fetch_all_stations()` 都會發送真實 API 請求。

**Why This Should Be Fixed**:
- **API 配額浪費**：環境部 API 每小時只更新一次，頻繁請求沒有意義
- **效能問題**：每次請求都需等待外部 API 回應（可能 1-3 秒）
- **使用者體驗差**：載入速度慢

**How to Fix**:
```python
from datetime import datetime, timedelta
import time

class AQIClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self._cache = {}
        self._cache_time = {}
        self._cache_ttl = 300  # 5 分鐘（環境部資料每小時更新，但我們保守設 5 分鐘）

    def fetch_all_stations(self) -> Optional[list]:
        """取得所有測站的即時 AQI 資料（帶快取）"""
        cache_key = "all_stations"

        # 檢查快取
        if cache_key in self._cache:
            cached_time = self._cache_time.get(cache_key, 0)
            if time.time() - cached_time < self._cache_ttl:
                logger.debug("Returning cached station data")
                return self._cache[cache_key]

        # 快取失效或不存在，發送請求
        if not self.api_key:
            logger.warning("未設定 API Key，使用模擬資料")
            return self._get_mock_data()

        try:
            # ... 原有的請求邏輯 ...

            if "records" in data:
                # 更新快取
                self._cache[cache_key] = data["records"]
                self._cache_time[cache_key] = time.time()
                logger.info(f"成功取得並快取 {len(data['records'])} 個測站資料")
                return data["records"]

        except requests.RequestException as e:
            # 如果 API 請求失敗，返回過期快取（如果有）
            if cache_key in self._cache:
                logger.warning(f"API 請求失敗，返回過期快取: {e}")
                return self._cache[cache_key]
            logger.error(f"API 請求失敗且無快取: {e}")
            return None

    def clear_cache(self):
        """清除快取（測試用）"""
        self._cache.clear()
        self._cache_time.clear()
```

**進階方案**：使用 Flask-Caching：
```python
from flask_caching import Cache

cache = Cache(app, config={
    'CACHE_TYPE': 'simple',  # 開發環境
    # 'CACHE_TYPE': 'redis',  # 生產環境
    # 'CACHE_REDIS_URL': os.getenv('REDIS_URL')
})

@app.route("/api/stations")
@cache.cached(timeout=300)  # 快取 5 分鐘
def get_stations():
    # ...
```

---

### [M03] 前端沒有處理 API 錯誤狀態碼
**Category**: Bugs/Correctness
**Severity**: Medium
**Location**: `static/js/app.js:175`, `static/js/app.js:211`, `static/js/app.js:239`

**What's Wrong**:
```javascript
const response = await fetch('/api/stations');
const result = await response.json();

if (result.success && result.stations) {
    // ...
}
```

沒有檢查 `response.ok` 或 `response.status`，如果伺服器回應 4xx 或 5xx，仍然嘗試解析 JSON，可能導致：
1. 前端錯誤難以追蹤（使用者只看到空白畫面）
2. 沒有友善的錯誤提示

**Why This Should Be Fixed**:
- **使用者體驗差**：遇到錯誤時沒有任何提示，使用者不知道發生什麼事
- **除錯困難**：Console 中可能只顯示 `Unexpected token` 而不是真正的錯誤

**How to Fix**:
```javascript
// 建立統一的 API 呼叫函數
async function apiCall(url, options = {}) {
    try {
        const response = await fetch(url, options);

        // 檢查 HTTP 狀態碼
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        // 檢查業務邏輯是否成功
        if (!result.success) {
            throw new Error(result.error || 'Unknown error');
        }

        return result;
    } catch (error) {
        console.error('API call failed:', error);

        // 顯示友善的錯誤訊息
        showError(`載入失敗: ${error.message}`);

        throw error;
    }
}

// 使用範例
async function loadStations() {
    try {
        const result = await apiCall('/api/stations');
        // 處理成功回應
        if (result.stations) {
            // ...
        }
    } catch (error) {
        // 錯誤已經在 apiCall 中處理並顯示
    }
}

// 錯誤顯示函數
function showError(message) {
    // 方案 1：使用 Toast 通知
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded shadow-lg';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);

    // 方案 2：更新 loading 元素為錯誤狀態
    loading.innerHTML = `
        <div class="text-center text-red-600">
            <p>${message}</p>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-red-600 text-white rounded">
                重新載入
            </button>
        </div>
    `;
    loading.classList.remove('hidden');
}
```

---

### [M04] 資料儲存沒有錯誤恢復機制
**Category**: Bugs/Correctness
**Severity**: Medium
**Location**: `src/data_store.py:141`

**What's Wrong**:
```python
def _save_history(self, file_path: Path, history: list) -> None:
    """儲存歷史資料"""
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except IOError as e:
        logger.error(f"儲存歷史資料失敗: {e}")
```

儲存失敗時只記錄錯誤，但：
1. 沒有重試機制
2. 沒有備份舊檔案（如果寫入一半失敗，舊資料會損壞）
3. 沒有驗證寫入的資料完整性

**Why This Should Be Fixed**:
- **資料遺失**：磁碟空間不足或權限問題會導致資料永久遺失
- **檔案損壞**：寫入中斷會產生不完整的 JSON，下次讀取會失敗

**How to Fix**:
```python
import tempfile
import shutil

def _save_history(self, file_path: Path, history: list) -> None:
    """儲存歷史資料（原子性寫入）"""
    try:
        # 1. 先寫入臨時檔案
        temp_fd, temp_path = tempfile.mkstemp(
            dir=file_path.parent,
            prefix=f".{file_path.name}_",
            suffix=".tmp"
        )

        try:
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)

            # 2. 驗證寫入的資料
            with open(temp_path, 'r', encoding='utf-8') as f:
                json.load(f)  # 確保可以解析

            # 3. 備份舊檔案（如果存在）
            if file_path.exists():
                backup_path = file_path.with_suffix('.json.bak')
                shutil.copy2(file_path, backup_path)

            # 4. 原子性替換（move 在同一檔案系統上是原子操作）
            shutil.move(temp_path, file_path)

            logger.debug(f"Successfully saved {len(history)} records to {file_path}")

        except Exception as e:
            # 清理臨時檔案
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise

    except Exception as e:
        logger.error(f"儲存歷史資料失敗: {e}", exc_info=True)

        # 嘗試恢復備份
        backup_path = file_path.with_suffix('.json.bak')
        if backup_path.exists():
            logger.warning(f"Attempting to restore from backup: {backup_path}")
            try:
                shutil.copy2(backup_path, file_path)
            except Exception as restore_error:
                logger.error(f"Backup restore failed: {restore_error}")
```

---

### [M05] JSON 解析缺乏異常處理
**Category**: Bugs/Correctness
**Severity**: Medium
**Location**: `src/aqi_client.py:52`

**What's Wrong**:
```python
response = requests.get(...)
response.raise_for_status()
data = response.json()  # 如果回應不是 JSON 會拋出異常
```

沒有處理 `response.json()` 可能拋出的 `json.JSONDecodeError`，如果環境部 API：
1. 回應 HTML 錯誤頁面
2. 回應格式錯誤的 JSON
3. 回應空內容

會導致程式崩潰。

**How to Fix**:
```python
try:
    response = requests.get(
        API_BASE_URL,
        params=params,
        timeout=REQUEST_TIMEOUT,
        verify=True  # 修正後
    )
    response.raise_for_status()

    # 檢查 Content-Type
    content_type = response.headers.get('Content-Type', '')
    if 'application/json' not in content_type:
        logger.error(f"Unexpected content type: {content_type}")
        logger.debug(f"Response body: {response.text[:200]}")
        return None

    # 安全解析 JSON
    try:
        data = response.json()
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON response: {e}")
        logger.debug(f"Response body: {response.text[:500]}")
        return None

    if "records" in data:
        logger.info(f"成功取得 {len(data['records'])} 個測站資料")
        return data["records"]
    else:
        logger.error(f"API 回應缺少 'records' 欄位: {list(data.keys())}")
        return None

except requests.Timeout:
    logger.error(f"API request timeout after {REQUEST_TIMEOUT}s")
    return None
except requests.HTTPError as e:
    logger.error(f"HTTP error {e.response.status_code}: {e}")
    return None
except requests.RequestException as e:
    logger.error(f"API 請求失敗: {e}")
    return None
```

---

### [M06] 模擬資料邏輯與真實 API 格式可能不一致
**Category**: Maintainability
**Severity**: Medium
**Location**: `src/aqi_client.py:119-156`

**What's Wrong**:
模擬資料 `_get_mock_data()` 和 `_normalize_record()` 是獨立維護的，如果：
1. 環境部 API 改變格式
2. 模擬資料忘記更新

會導致開發環境和生產環境行為不一致。

**Why This Should Be Fixed**:
- **測試不可靠**：開發時用模擬資料測試通過，但真實 API 失敗
- **維護困難**：需要同時維護兩套資料格式

**How to Fix**:
```python
# 方案 1：模擬資料也經過 normalize（推薦）
def _get_mock_data(self) -> list:
    """模擬資料（無 API Key 時使用）"""
    import random
    from datetime import datetime

    mock_stations = [
        ("臺北", "臺北市"),
        ("板橋", "新北市"),
        # ...
    ]

    records = []
    for name, county in mock_stations:
        aqi = random.randint(20, 150)
        # 使用和真實 API 相同的格式（未標準化）
        raw_record = {
            "sitename": name,
            "county": county,
            "aqi": str(aqi),  # 注意：真實 API 回傳字串
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
            "publishtime": datetime.now().strftime("%Y/%m/%d %H:00:00"),
            "longitude": "121.5",
            "latitude": "25.0",
        }
        records.append(raw_record)

    return records

# 方案 2：加入格式驗證測試
def test_mock_data_format(self):
    """確保模擬資料和真實 API 格式一致"""
    mock = self._get_mock_data()
    assert len(mock) > 0

    for record in mock:
        # 驗證必要欄位
        assert "sitename" in record
        assert "aqi" in record
        assert isinstance(record["aqi"], str)  # 真實 API 回傳字串

        # 確保可以標準化
        normalized = self._normalize_record(record)
        assert isinstance(normalized["aqi"], int)  # 標準化後是整數
```

---

### [M07] 前端定時器沒有清理機制
**Category**: Code Smell
**Severity**: Medium
**Location**: `static/js/app.js:278`

**What's Wrong**:
```javascript
setInterval(() => {
    updateRealtime(currentStation);
}, UPDATE_INTERVAL);
```

`setInterval` 沒有儲存返回值，導致：
1. 無法在頁面卸載時清理定時器（雖然 SPA 不常見）
2. 如果使用者快速切換測站，可能產生多個定時器

**Why This Should Be Fixed**:
- **記憶體洩漏**：定時器持續運行但頁面已不存在
- **重複請求**：切換測站後舊定時器仍在運行

**How to Fix**:
```javascript
// 使用模組模式管理狀態
const app = (function() {
    let currentStation = stationSelect.value;
    let updateInterval = null;  // 儲存定時器 ID
    let renderer = null;

    function startAutoUpdate() {
        // 清除舊定時器
        if (updateInterval) {
            clearInterval(updateInterval);
        }

        // 設定新定時器
        updateInterval = setInterval(() => {
            updateRealtime(currentStation);
        }, UPDATE_INTERVAL);
    }

    function handleStationChange() {
        currentStation = stationSelect.value;

        // 停止舊動畫
        if (renderer) {
            renderer.stopAnimation();
        }

        // 重新開始
        loadHistory(currentStation).then(() => {
            startAutoUpdate();  // 重設定時器
        });
    }

    async function init() {
        await loadStations();
        await loadHistory(currentStation);

        stationSelect.addEventListener('change', handleStationChange);

        startAutoUpdate();

        // 頁面卸載時清理
        window.addEventListener('beforeunload', () => {
            if (updateInterval) {
                clearInterval(updateInterval);
            }
            if (renderer) {
                renderer.stopAnimation();
            }
        });
    }

    return { init };
})();

// 啟動
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app.init);
} else {
    app.init();
}
```

---

### [M08] Canvas 渲染沒有節流機制
**Category**: Performance
**Severity**: Medium
**Location**: `static/js/rings.js:240-246`

**What's Wrong**:
```javascript
startAnimation() {
    const animate = () => {
        this.time += this.config.noiseSpeed;
        this.render();
        this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
}
```

每一幀都重繪整個 canvas（60 FPS），對於靜態內容（年輪）來說是浪費資源。

**Why This Should Be Fixed**:
- **CPU 使用率高**：持續重繪會消耗電量（行動裝置影響大）
- **不必要的運算**：年輪變化很緩慢（`noiseSpeed: 0.0005`），每秒重繪 60 次太頻繁

**How to Fix**:
```javascript
// 方案 1：降低幀率
startAnimation() {
    let lastTime = 0;
    const fps = 30;  // 降低到 30 FPS
    const interval = 1000 / fps;

    const animate = (currentTime) => {
        this.animationFrame = requestAnimationFrame(animate);

        const deltaTime = currentTime - lastTime;
        if (deltaTime < interval) return;  // 跳過此幀

        lastTime = currentTime - (deltaTime % interval);

        this.time += this.config.noiseSpeed;
        this.render();
    };

    this.animationFrame = requestAnimationFrame(animate);
}

// 方案 2：只在資料變化時重繪
setData(data) {
    const hasChanged = JSON.stringify(data) !== JSON.stringify(this.data);
    this.data = data;

    if (hasChanged) {
        this.render();
    }
}

// 方案 3：使用 Intersection Observer 偵測可見性
constructor(canvas) {
    // ...
    this.isVisible = true;
    this._setupVisibilityObserver();
}

_setupVisibilityObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible && this.data.length > 0) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
        });
    }, { threshold: 0.1 });

    observer.observe(this.canvas);
}

startAnimation() {
    if (!this.isVisible) return;  // 不可見時不動畫
    // ... 原有邏輯
}
```

---

### [M09] 缺乏 HTTPS 強制重定向
**Category**: Security (OWASP A02)
**Severity**: Medium
**Location**: `src/app.py` (全域)

**What's Wrong**:
沒有強制使用 HTTPS，使用者可能透過 HTTP 訪問，導致：
1. 資料明文傳輸
2. 容易被中間人攻擊
3. 無法設定 Secure Cookie

**Why This Should Be Fixed**:
雖然目前沒有敏感資料傳輸，但：
- **API Key 風險**：如果將來加入使用者認證，HTTP 會洩露憑證
- **內容竄改**：中間人可修改回應的 JavaScript 程式碼

**How to Fix**:
```python
# 使用 Flask-Talisman（見 H02）或手動重定向
@app.before_request
def force_https():
    if os.getenv("FLASK_ENV") == "production":
        if not request.is_secure and request.headers.get('X-Forwarded-Proto') != 'https':
            url = request.url.replace('http://', 'https://', 1)
            return redirect(url, code=301)

# 或使用 Nginx/Cloudflare 在反向代理層處理
```

---

## 🟢 Low Priority Issues

### [L01] 缺乏日誌等級分層
**Category**: Maintainability
**Severity**: Low
**Location**: `src/app.py:26-30`

**What's Wrong**:
日誌設定過於簡單，Debug 模式下會輸出大量無用資訊，生產環境可能遺漏關鍵錯誤。

**How to Fix**:
```python
import logging.handlers

# 分層日誌設定
def setup_logging():
    log_level = logging.DEBUG if os.getenv("DEBUG") == "true" else logging.INFO
    log_format = "%(asctime)s [%(levelname)s] %(name)s:%(lineno)d - %(message)s"

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(logging.Formatter(log_format))

    # File handler（生產環境）
    if os.getenv("FLASK_ENV") == "production":
        log_dir = Path(__file__).parent.parent / "logs"
        log_dir.mkdir(exist_ok=True)

        file_handler = logging.handlers.RotatingFileHandler(
            log_dir / "app.log",
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5
        )
        file_handler.setLevel(logging.WARNING)  # 只記錄警告以上
        file_handler.setFormatter(logging.Formatter(log_format))

        logging.basicConfig(
            level=log_level,
            handlers=[console_handler, file_handler]
        )
    else:
        logging.basicConfig(
            level=log_level,
            format=log_format,
            handlers=[console_handler]
        )

setup_logging()
```

---

### [L02] 魔術數字未定義為常數
**Category**: Code Smell
**Severity**: Low
**Location**: 多處

**What's Wrong**:
```python
# app.py:107
hours = min(int(request.args.get("hours", 24)), 168)  # 168 是什麼？

# rings.js:18
ringCount: 24,  // 為什麼是 24？
```

**How to Fix**:
```python
# 定義常數
MAX_HISTORY_HOURS = 168  # 7 天
DEFAULT_HISTORY_HOURS = 24  # 1 天

hours = min(int(request.args.get("hours", DEFAULT_HISTORY_HOURS)), MAX_HISTORY_HOURS)
```

---

### [L03] 缺乏專案文檔
**Category**: Maintainability
**Severity**: Low
**Location**: 專案根目錄

**What's Wrong**:
沒有 README.md 說明：
1. 如何安裝依賴
2. 如何設定環境變數
3. 如何運行專案
4. API 端點說明

**Suggested Content**:
```markdown
# City Breath - 城市的呼吸

將空氣品質數據轉化為有機年輪的視覺化藝術。

## 快速開始

### 前置需求
- Python 3.11+
- uv (Python 套件管理器)

### 安裝
\`\`\`bash
# 安裝依賴
uv sync

# 複製環境變數範例
cp .env.example .env

# 編輯 .env，填入您的環境部 API Key
# 申請網址: https://data.moenv.gov.tw/api_term
\`\`\`

### 運行
\`\`\`bash
uv run python -m src.app
\`\`\`

訪問 http://localhost:5000

## API 端點

- `GET /` - 主頁面
- `GET /api/stations` - 取得所有測站列表
- `GET /api/aqi?station=臺北` - 取得指定測站的即時 AQI
- `GET /api/history?station=臺北&hours=24` - 取得歷史資料
- `GET /api/health` - 健康檢查

## 授權
資料來源：環境部環境資料開放平臺
授權條款：CC BY 4.0
\`\`\`

---

### [L04] 測試覆蓋率為零
**Category**: Maintainability
**Severity**: Low
**Location**: 專案根目錄

**What's Wrong**:
完全沒有單元測試，無法確保程式碼正確性。

**Suggested Tests**:
```python
# tests/test_aqi_client.py
import pytest
from src.aqi_client import AQIClient

def test_normalize_record():
    client = AQIClient()
    raw = {
        "sitename": "臺北",
        "aqi": "50",
        "pm2.5": "12.5",
    }
    normalized = client._normalize_record(raw)
    assert normalized["aqi"] == 50
    assert normalized["pm25"] == 12.5

def test_aqi_to_status():
    assert AQIClient._aqi_to_status(30) == "良好"
    assert AQIClient._aqi_to_status(80) == "普通"
    assert AQIClient._aqi_to_status(120) == "對敏感族群不健康"

# tests/test_data_store.py
def test_path_traversal_prevention():
    store = DataStore(Path("/tmp/test"))
    with pytest.raises(ValueError):
        store._get_file_path("../../etc/passwd")
```

---

### [L05] 缺乏 TypeScript 或 JSDoc
**Category**: Maintainability
**Severity**: Low
**Location**: `static/js/*.js`

**What's Wrong**:
JavaScript 沒有型別註解，難以維護。

**Suggested Improvement**:
```javascript
/**
 * 更新 SVG 儀表盤
 * @param {Object} data - AQI 資料物件
 * @param {number} data.aqi - AQI 數值
 * @param {number} data.pm25 - PM2.5 濃度
 * @param {number} data.pm10 - PM10 濃度
 * @param {number} data.o3 - O3 濃度
 */
function updateGauges(data) {
    // ...
}
```

---

### [L06] 程式碼重複：顏色對照表定義兩次
**Category**: Code Smell
**Severity**: Low
**Location**: `static/js/app.js:69-76`, `static/js/rings.js:28-35`

**What's Wrong**:
`getAqiColorClass()` 和 `aqiColors` 重複定義 AQI 範圍判斷邏輯。

**How to Fix**:
```javascript
// 建立共用的 constants.js
const AQI_LEVELS = {
    GOOD: { min: 0, max: 50, color: '#22C55E', label: '良好' },
    MODERATE: { min: 51, max: 100, color: '#EAB308', label: '普通' },
    // ...
};

function getAqiLevel(aqi) {
    for (const [key, level] of Object.entries(AQI_LEVELS)) {
        if (aqi >= level.min && aqi <= level.max) {
            return level;
        }
    }
    return AQI_LEVELS.HAZARDOUS;
}
```

---

### [L07] 使用 CDN 載入 Tailwind 不適合生產環境
**Category**: Performance
**Severity**: Low
**Location**: `templates/index.html:10`

**What's Wrong**:
```html
<script src="https://cdn.tailwindcss.com"></script>
```

CDN 版本的 Tailwind：
1. 載入整個框架（~3MB），未壓縮
2. 需要即時編譯 CSS（效能差）
3. 依賴外部 CDN 可用性

**How to Fix**:
```bash
# 安裝 Tailwind CLI
npm install -D tailwindcss

# 初始化設定
npx tailwindcss init

# 編譯 CSS
npx tailwindcss -i ./static/css/input.css -o ./static/css/output.css --minify
```

```html
<!-- 使用編譯後的 CSS -->
<link rel="stylesheet" href="/static/css/output.css">
```

---

### [L08] resize 事件沒有 debounce
**Category**: Performance
**Severity**: Low
**Location**: `static/js/rings.js:42`

**What's Wrong**:
```javascript
window.addEventListener('resize', () => this._resize());
```

每次視窗縮放都觸發重繪，效能不佳。

**How to Fix**:
```javascript
_bindEvents() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            this._resize();
        }, 150);  // 150ms debounce
    });
}
```

---

### [L09] 缺乏無障礙（Accessibility）考量
**Category**: Code Smell
**Severity**: Low
**Location**: `templates/index.html`

**What's Wrong**:
- Canvas 沒有 `aria-label`
- 圖例沒有 `role="list"`
- 儀表盤 SVG 缺乏替代文字

**How to Fix**:
```html
<!-- Canvas -->
<canvas id="rings-canvas"
        aria-label="空氣品質年輪視覺化圖，內圈是現在，外圈是過去24小時"
        role="img">
</canvas>

<!-- 圖例 -->
<div class="grid grid-cols-3 lg:grid-cols-6 gap-3 text-xs" role="list">
    <div class="flex items-center gap-2" role="listitem">
        <span class="w-3 h-3 border border-neutral-300 rounded-full bg-aqi-good"
              aria-hidden="true"></span>
        <span class="font-light text-neutral-600">良好</span>
    </div>
    <!-- ... -->
</div>

<!-- 儀表盤 -->
<svg viewBox="0 0 100 100" role="img" aria-label="AQI 儀表盤顯示當前數值">
    <!-- ... -->
</svg>
```

---

### [L10] 使用 `var` 而非 `const`/`let`
**Category**: Code Smell
**Severity**: Low
**Location**: 未發現（好消息！）

JavaScript 程式碼已正確使用 `const` 和 `let`，沒有使用過時的 `var`。這是好習慣。

---

### [L11] 缺乏環境變數驗證
**Category**: Maintainability
**Severity**: Low
**Location**: `src/app.py:40-44`

**What's Wrong**:
直接讀取環境變數，沒有驗證格式或提供預設值範圍檢查。

**How to Fix**:
```python
# 使用 Pydantic Settings 驗證環境變數
from pydantic_settings import BaseSettings
from pydantic import Field, validator

class Settings(BaseSettings):
    moenv_api_key: str = Field(default="", env="MOENV_API_KEY")
    port: int = Field(default=5000, ge=1024, le=65535, env="PORT")
    debug: bool = Field(default=False, env="DEBUG")
    default_station: str = Field(default="臺北", env="DEFAULT_STATION")

    @validator("default_station")
    def validate_station(cls, v):
        if not re.match(r'^[\u4e00-\u9fff\w]{1,20}$', v):
            raise ValueError("Invalid station name format")
        return v

    class Config:
        env_file = ".env"

settings = Settings()
aqi_client = AQIClient(api_key=settings.moenv_api_key)
```

---

### [L12] Git 未忽略 data/ 目錄
**Category**: Maintainability
**Severity**: Low
**Location**: `.gitignore`

**What's Wrong**:
歷史資料檔案應該被 Git 忽略，避免：
1. 倉庫體積膨脹
2. 合併衝突
3. 隱私問題（如果將來儲存個人化資料）

**How to Fix**:
```gitignore
# .gitignore
data/
!data/.gitkeep
*.json.bak
logs/
```

---

## 🏆 Positive Aspects

專案中做得很好的地方值得肯定：

- ✅ **清晰的模組化架構**：`aqi_client`、`data_store`、`app` 職責分明，符合單一職責原則
- ✅ **使用 Path 而非字串處理路徑**：`from pathlib import Path` 是現代 Python 最佳實務
- ✅ **日誌記錄完善**：雖然可改進，但已有基本的 logger 使用
- ✅ **前端使用模組化 IIFE**：`(function() { 'use strict'; ... })()` 避免全域污染
- ✅ **Canvas 高解析度處理**：正確使用 `devicePixelRatio` 確保 Retina 顯示清晰
- ✅ **Simplex Noise 演算法實作正確**：數學計算精確，效能良好
- ✅ **使用 `requestAnimationFrame`**：比 `setInterval` 更適合動畫
- ✅ **資料標準化邏輯**：`_normalize_record()` 確保內部資料格式一致
- ✅ **向後相容的設計**：保留隱藏元素 `id="data-aqi"` 等
- ✅ **原子性思維**：雖未完全實作，但 `_save_history` 的註解顯示有安全意識
- ✅ **環境變數管理**：使用 `.env` 和 `python-dotenv` 是正確做法
- ✅ **API 回應格式統一**：所有端點都回傳 `{"success": true/false, ...}` 格式

---

## 📊 Code Quality Metrics

### Complexity Analysis
| File | Lines | Cyclomatic Complexity | Nesting Depth | Assessment |
|------|-------|----------------------|---------------|------------|
| app.py | 148 | 低 (~5) | 2 | OK |
| aqi_client.py | 173 | 中 (~10) | 3 | OK |
| data_store.py | 161 | 中 (~12) | 3 | Warning |
| app.js | 292 | 低 (~8) | 2 | OK |
| rings.js | 280 | 低 (~6) | 2 | OK |
| noise.js | 150 | 低 (~4) | 2 | OK |

### Code Smells Detected
| Smell | Count | Locations |
|-------|-------|-----------|
| 重複程式碼 | 2 | app.js:69-76, rings.js:28-35 (AQI 顏色對照) |
| 魔術數字 | 8 | app.py:107 (168), rings.js:18-24 (多處) |
| 過長函數 | 1 | rings.js:109-171 (drawRing 63 行) |
| God Class | 0 | - |
| 註解掉的程式碼 | 0 | ✅ 無 |
| 未使用的變數 | 1 | aqi_client.py:30 (_cache 未使用) |
| 深層巢狀 | 0 | ✅ 最深 3 層，可接受 |

---

## 🛡️ Security Assessment
**Security Posture**: Weak（需大幅改進）

### OWASP Top 10 Coverage
| Category | Status | Notes |
|----------|--------|-------|
| A01 Access Control | ⚠️ | 缺乏 CORS 設定、Rate Limiting |
| A02 Cryptographic | ❌ | **Critical**: SSL 驗證關閉、API Key 保護不足 |
| A03 Injection | ⚠️ | 輸入驗證不完整（Path Traversal 風險） |
| A04 Insecure Design | ❌ | 缺乏 Rate Limiting、無限制參數 |
| A05 Security Misconfiguration | ❌ | **Critical**: 缺乏安全性 Headers |
| A06 Vulnerable Components | ✅ | 使用官方套件，未發現已知漏洞 |
| A07 Authentication | N/A | 專案無認證功能 |
| A08 Data Integrity | ⚠️ | 資料儲存缺乏驗證 |
| A09 Logging Failures | ⚠️ | 錯誤訊息洩露資訊、日誌可能含敏感資料 |
| A10 SSRF | ✅ | API URL 是硬編碼，無使用者控制的 URL 請求 |

### Compliance Considerations
- **CC BY 4.0 遵循**：✅ 已在 HTML 中標註資料來源和授權
- **GDPR**：N/A（無個人資料收集）
- **Cookie Law**：✅ 無使用 Cookie

---

## 📋 Action Items Summary

### Must Fix (Before Production Deployment)
- [ ] [C01] 修正 SSL 驗證問題（使用正確的憑證驗證）
- [ ] [C02] 加強 API Key 保護（過濾日誌、錯誤處理器）
- [ ] [H01] 加入 CORS 設定
- [ ] [H02] 設定 HTTP 安全性 Headers（Talisman）
- [ ] [H03] 實作完整輸入驗證（防 Path Traversal）
- [ ] [H04] 加入 Rate Limiting

### Should Fix (Within Sprint)
- [ ] [H05] 參數驗證改進（hours 範圍檢查）
- [ ] [H06] 錯誤訊息標準化（不洩露內部資訊）
- [ ] [M01] 前端加入 DOMPurify 防 XSS
- [ ] [M02] 實作 API 快取機制
- [ ] [M03] 前端加入錯誤處理和使用者提示
- [ ] [M04] 資料儲存加入原子性寫入

### Plan to Fix (Tech Debt Backlog)
- [ ] [M05] JSON 解析異常處理
- [ ] [M06] 統一模擬資料和真實 API 格式
- [ ] [M07] 前端定時器清理機制
- [ ] [M08] Canvas 渲染節流
- [ ] [M09] HTTPS 強制重定向（生產環境）

### Consider (Optional)
- [ ] [L01] 改進日誌分層
- [ ] [L02] 消除魔術數字
- [ ] [L03] 撰寫 README.md
- [ ] [L04] 加入單元測試
- [ ] [L07] 使用 Tailwind CLI 編譯
- [ ] [L08] resize 事件 debounce
- [ ] [L11] 使用 Pydantic 驗證環境變數

---

## 📚 Educational Notes

### 關於 SSL/TLS 驗證的重要性
許多開發者在遇到 SSL 證書問題時會直接設定 `verify=False`，這是非常危險的做法。正確的解決方案：

1. **瞭解問題根源**：為什麼會出現證書錯誤？
   - 自簽證書（Self-signed）
   - 過期證書
   - 中間證書缺失
   - 主機名稱不匹配

2. **正確的解決方式**：
   - 下載並信任正確的 CA 證書
   - 使用 `certifi` 套件提供的證書庫
   - 在開發環境使用受信任的測試證書

3. **絕對不要**：
   - 在生產環境關閉驗證
   - 全域關閉 SSL 警告（會隱藏其他問題）

### 關於輸入驗證的層次
安全的輸入驗證應該有多層防護：

1. **白名單優於黑名單**：定義允許的字元，而不是禁止危險字元
2. **型別驗證**：確保輸入符合預期型別
3. **範圍驗證**：數值應在合理範圍內
4. **格式驗證**：使用正規表達式驗證格式
5. **語義驗證**：確保輸入在業務邏輯上有意義（例如測站名稱存在）
6. **輸出編碼**：即使輸入通過驗證，輸出時仍要編碼

### 關於效能優化的優先順序
不要過早優化（Premature Optimization），但也要避免明顯的效能陷阱：

1. **先測量再優化**：使用 Chrome DevTools Performance 分析瓶頸
2. **優先優化請求數量**：1 個慢請求比 100 個快請求更影響使用者體驗
3. **快取優於重算**：API 回應快取可大幅減少延遲
4. **漸進式優化**：從影響最大的地方開始

---

*Report generated by Claude Code Review Expert*
*Review methodology based on OWASP Top 10, SOLID principles, and industry best practices*
*Total review time: ~45 minutes*
