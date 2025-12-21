/**
 * City Breath - 主程式
 *
 * 資料來源：環境部環境資料開放平臺
 * 授權條款：CC BY 4.0
 */

(function() {
    'use strict';

    // DOM 元素
    const canvas = document.getElementById('rings-canvas');
    const loading = document.getElementById('loading');
    const centerInfo = document.getElementById('center-info');
    const currentAqi = document.getElementById('current-aqi');
    const currentStatus = document.getElementById('current-status');
    const stationSelect = document.getElementById('station-select');

    // 資料顯示元素（隱藏，向後相容）
    const dataAqi = document.getElementById('data-aqi');
    const dataPm25 = document.getElementById('data-pm25');
    const dataPm10 = document.getElementById('data-pm10');
    const dataO3 = document.getElementById('data-o3');
    const dataTime = document.getElementById('data-time');

    // SVG 儀表盤元素
    const gaugeAqi = document.getElementById('gauge-aqi');
    const gaugeAqiText = document.getElementById('gauge-aqi-text');
    const gaugePm25 = document.getElementById('gauge-pm25');
    const gaugePm25Text = document.getElementById('gauge-pm25-text');
    const gaugePm10 = document.getElementById('gauge-pm10');
    const gaugePm10Text = document.getElementById('gauge-pm10-text');
    const gaugeO3 = document.getElementById('gauge-o3');
    const gaugeO3Text = document.getElementById('gauge-o3-text');

    // 儀表盤常數
    const GAUGE_CIRCUMFERENCE = 283; // 2 * π * 45
    const GAUGE_RANGES = {
        aqi: 500,
        pm25: 100,
        pm10: 200,
        o3: 150
    };

    // 初始化渲染器
    const renderer = new RingsRenderer(canvas);

    // 當前測站
    let currentStation = stationSelect.value;

    // M07: 儲存定時器 ID 以便清理
    let updateIntervalId = null;

    // 更新間隔 (毫秒)
    const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 分鐘

    // ================================================================
    // M03: 統一 API 呼叫函數（含錯誤處理）
    // ================================================================
    async function apiCall(url) {
        const response = await fetch(url);

        // 檢查 HTTP 狀態碼
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
        }

        const result = await response.json();

        // 檢查業務邏輯是否成功
        if (!result.success) {
            throw new Error(result.error || 'Unknown error');
        }

        return result;
    }

    /**
     * M03: 顯示錯誤訊息
     */
    function showError(message) {
        console.error(message);

        // 在 loading 區域顯示錯誤
        if (loading) {
            loading.innerHTML = `
                <div class="text-center">
                    <p class="text-red-600 mb-4">${escapeHtml(message)}</p>
                    <button onclick="location.reload()" class="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors">
                        重新載入
                    </button>
                </div>
            `;
            loading.classList.remove('hidden');
        }
    }

    /**
     * M03: HTML 轉義（防 XSS）
     */
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * 取得 AQI 狀態文字
     */
    function getStatusText(aqi) {
        if (aqi <= 50) return '良好';
        if (aqi <= 100) return '普通';
        if (aqi <= 150) return '對敏感族群不健康';
        if (aqi <= 200) return '對所有族群不健康';
        if (aqi <= 300) return '非常不健康';
        return '危害';
    }

    /**
     * 取得 AQI 顏色 (Tailwind class)
     */
    function getAqiColorClass(aqi) {
        if (aqi <= 50) return 'text-aqi-good';
        if (aqi <= 100) return 'text-aqi-moderate';
        if (aqi <= 150) return 'text-aqi-unhealthy-sensitive';
        if (aqi <= 200) return 'text-aqi-unhealthy';
        if (aqi <= 300) return 'text-aqi-very-unhealthy';
        return 'text-aqi-hazardous';
    }

    /**
     * 取得 AQI 文字顏色（深色版，適合白底）
     */
    function getAqiTextStyle(aqi) {
        // 白底上需要更深的顏色才看得清楚
        if (aqi <= 50) return 'color: #15803D';      // 深綠
        if (aqi <= 100) return 'color: #B45309';     // 深琥珀（黃色在白底看不見）
        if (aqi <= 150) return 'color: #C2410C';     // 深橘
        if (aqi <= 200) return 'color: #DC2626';     // 紅
        if (aqi <= 300) return 'color: #7E22CE';     // 紫
        return 'color: #7E0023';                      // 深紅
    }

    /**
     * 計算儀表盤 dashoffset
     */
    function calcGaugeDashoffset(value, maxValue) {
        if (value === null || value === undefined || isNaN(value)) return GAUGE_CIRCUMFERENCE;
        const ratio = Math.min(value / maxValue, 1);
        return GAUGE_CIRCUMFERENCE - (ratio * GAUGE_CIRCUMFERENCE);
    }

    /**
     * 更新 SVG 儀表盤
     */
    function updateGauges(data) {
        if (!data) return;

        // AQI
        if (gaugeAqi && gaugeAqiText) {
            gaugeAqi.style.strokeDashoffset = calcGaugeDashoffset(data.aqi, GAUGE_RANGES.aqi);
            gaugeAqiText.textContent = data.aqi || '--';
        }

        // PM2.5
        if (gaugePm25 && gaugePm25Text) {
            gaugePm25.style.strokeDashoffset = calcGaugeDashoffset(data.pm25, GAUGE_RANGES.pm25);
            gaugePm25Text.textContent = data.pm25 ? data.pm25.toFixed(1) : '--';
        }

        // PM10
        if (gaugePm10 && gaugePm10Text) {
            gaugePm10.style.strokeDashoffset = calcGaugeDashoffset(data.pm10, GAUGE_RANGES.pm10);
            gaugePm10Text.textContent = data.pm10 ? Math.round(data.pm10) : '--';
        }

        // O3
        if (gaugeO3 && gaugeO3Text) {
            gaugeO3.style.strokeDashoffset = calcGaugeDashoffset(data.o3, GAUGE_RANGES.o3);
            gaugeO3Text.textContent = data.o3 ? Math.round(data.o3) : '--';
        }
    }

    /**
     * 更新側邊欄資料
     */
    function updateSidebar(data) {
        if (!data) return;

        // 更新隱藏元素（向後相容）
        if (dataAqi) {
            dataAqi.textContent = data.aqi;
            dataAqi.className = `font-mono text-lg ${getAqiColorClass(data.aqi)}`;
        }
        if (dataPm25) dataPm25.textContent = `${data.pm25 || '--'} μg/m³`;
        if (dataPm10) dataPm10.textContent = `${data.pm10 || '--'} μg/m³`;
        if (dataO3) dataO3.textContent = `${data.o3 || '--'} ppb`;

        // 格式化時間
        if (data.publishtime && dataTime) {
            const time = data.publishtime.replace(/\//g, '-');
            dataTime.textContent = time;
        }

        // 更新 SVG 儀表盤
        updateGauges(data);
    }

    /**
     * 更新中心顯示
     */
    function updateCenter(data) {
        if (!data) return;

        currentAqi.textContent = data.aqi;
        currentAqi.className = 'text-5xl lg:text-6xl font-light font-mono';
        currentAqi.style.cssText = getAqiTextStyle(data.aqi);
        currentStatus.textContent = getStatusText(data.aqi);

        centerInfo.style.opacity = '1';
    }

    /**
     * 載入測站列表
     */
    async function loadStations() {
        try {
            const result = await apiCall('/api/stations');

            if (result.stations) {
                stationSelect.innerHTML = '';

                // 依縣市分組
                for (const [county, stations] of Object.entries(result.stations)) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = county;

                    for (const station of stations) {
                        const option = document.createElement('option');
                        option.value = station.name;
                        option.textContent = station.name;
                        if (station.name === currentStation) {
                            option.selected = true;
                        }
                        optgroup.appendChild(option);
                    }

                    stationSelect.appendChild(optgroup);
                }
            }
        } catch (error) {
            console.error('載入測站列表失敗:', error);
            // 測站列表載入失敗不阻止其他功能
        }
    }

    /**
     * 載入歷史資料
     */
    async function loadHistory(station) {
        try {
            loading.classList.remove('hidden');
            // 恢復 loading 原始內容
            loading.innerHTML = '<div class="animate-pulse text-neutral-400">載入中...</div>';

            const result = await apiCall(`/api/history?station=${encodeURIComponent(station)}&hours=24`);

            if (result.data) {
                renderer.setData(result.data);

                // 更新側邊欄和中心（使用最新資料）
                const latest = result.data[result.data.length - 1];
                updateSidebar(latest);
                updateCenter(latest);

                // 開始動畫
                renderer.startAnimation();
            }

            loading.classList.add('hidden');
        } catch (error) {
            showError(`載入失敗: ${error.message}`);
        }
    }

    /**
     * 更新即時資料
     */
    async function updateRealtime(station) {
        try {
            const result = await apiCall(`/api/aqi?station=${encodeURIComponent(station)}`);

            if (result.data) {
                // 更新側邊欄
                updateSidebar(result.data);
                updateCenter(result.data);

                // 重新載入歷史以包含新資料
                await loadHistory(station);
            }
        } catch (error) {
            console.error('更新即時資料失敗:', error);
            // 即時更新失敗不阻止頁面運作
        }
    }

    /**
     * M07: 啟動自動更新
     */
    function startAutoUpdate() {
        // 清除舊定時器
        if (updateIntervalId) {
            clearInterval(updateIntervalId);
        }

        // 設定新定時器
        updateIntervalId = setInterval(() => {
            updateRealtime(currentStation);
        }, UPDATE_INTERVAL);
    }

    /**
     * 測站變更處理
     */
    function handleStationChange() {
        currentStation = stationSelect.value;
        renderer.stopAnimation();
        loadHistory(currentStation);
        // 重設定時器
        startAutoUpdate();
    }

    /**
     * M07: 頁面卸載時清理
     */
    function cleanup() {
        if (updateIntervalId) {
            clearInterval(updateIntervalId);
            updateIntervalId = null;
        }
        if (renderer) {
            renderer.stopAnimation();
        }
    }

    /**
     * 初始化
     */
    async function init() {
        // 載入測站列表
        await loadStations();

        // 載入歷史資料
        await loadHistory(currentStation);

        // 綁定事件
        stationSelect.addEventListener('change', handleStationChange);

        // M07: 頁面卸載時清理
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('pagehide', cleanup);

        // 啟動定時更新
        startAutoUpdate();

        console.log('City Breath 初始化完成');
    }

    // 啟動
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
