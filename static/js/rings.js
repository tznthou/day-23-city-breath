/**
 * City Breath - 年輪繪製引擎
 *
 * 將 AQI 數據轉化為有機年輪視覺化
 */

class RingsRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.noise = new SimplexNoise(42);
        this.data = [];
        this.animationFrame = null;
        this.time = 0;

        // M08: 幀率控制
        this.targetFPS = 30;  // 降低到 30 FPS（節省電量）
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;

        // L08: resize debounce
        this.resizeTimeout = null;

        // 設定
        this.config = {
            ringCount: 24,           // 年輪數量
            ringSpacing: 8,          // 年輪間距
            baseRadius: 60,          // 中心半徑（留空給數字顯示）
            noiseScale: 0.02,        // 噪點縮放
            noiseSpeed: 0.0005,      // 動畫速度
            strokeWidth: 1.5,        // 線條寬度（極簡風格較細）
            glowIntensity: 0.2,      // 發光強度（極簡風格較弱）
        };

        // AQI 顏色對照（調深適合白底顯示）
        this.aqiColors = {
            good: { range: [0, 50], color: '#22C55E', name: '良好' },           // 綠色
            moderate: { range: [51, 100], color: '#EAB308', name: '普通' },     // 深黃/金色
            unhealthySensitive: { range: [101, 150], color: '#F97316', name: '對敏感族群不健康' }, // 橘
            unhealthy: { range: [151, 200], color: '#EF4444', name: '對所有族群不健康' },  // 紅
            veryUnhealthy: { range: [201, 300], color: '#A855F7', name: '非常不健康' },    // 紫
            hazardous: { range: [301, 500], color: '#991B1B', name: '危害' },   // 深紅
        };

        this._resize();
        this._bindEvents();
    }

    _bindEvents() {
        // L08: 使用 debounce 處理 resize
        window.addEventListener('resize', () => {
            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout);
            }
            this.resizeTimeout = setTimeout(() => {
                this._resize();
            }, 150);  // 150ms debounce
        });
    }

    _resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const size = Math.min(rect.width, rect.height);

        this.canvas.width = size * dpr;
        this.canvas.height = size * dpr;
        this.canvas.style.width = `${size}px`;
        this.canvas.style.height = `${size}px`;

        this.ctx.scale(dpr, dpr);
        this.size = size;
        this.center = { x: size / 2, y: size / 2 };

        // 重新計算間距
        const maxRadius = (size / 2) * 0.85;
        this.config.ringSpacing = (maxRadius - this.config.baseRadius) / this.config.ringCount;

        if (this.data.length > 0) {
            this.render();
        }
    }

    /**
     * 設定資料
     * @param {Array} data - 歷史 AQI 資料陣列
     */
    setData(data) {
        this.data = data;
        this.render();
    }

    /**
     * 取得 AQI 對應的顏色
     * @param {number} aqi
     * @returns {string} 顏色值
     */
    getAqiColor(aqi) {
        for (const level of Object.values(this.aqiColors)) {
            if (aqi >= level.range[0] && aqi <= level.range[1]) {
                return level.color;
            }
        }
        return this.aqiColors.hazardous.color;
    }

    /**
     * 計算噪點強度（基於 PM2.5）
     * @param {number} pm25
     * @returns {number} 0-1 之間的強度
     */
    getNoiseIntensity(pm25) {
        // PM2.5: 0-15 = 無噪點, 15-35 = 輕微, 35-54 = 中等, 54+ = 強烈
        if (pm25 <= 15) return 0;
        if (pm25 <= 35) return (pm25 - 15) / 20 * 0.3;
        if (pm25 <= 54) return 0.3 + (pm25 - 35) / 19 * 0.3;
        return Math.min(1, 0.6 + (pm25 - 54) / 100 * 0.4);
    }

    /**
     * 繪製單一年輪
     * @param {number} index - 年輪索引（0 = 最外圈）
     * @param {object} data - AQI 資料
     */
    drawRing(index, data) {
        const ctx = this.ctx;
        const { center, config, noise, time } = this;

        // 半徑：內圈是最新的，外圈是最舊的
        const radius = config.baseRadius + (config.ringCount - 1 - index) * config.ringSpacing;

        // 顏色
        const color = this.getAqiColor(data.aqi);

        // 噪點強度
        const noiseIntensity = this.getNoiseIntensity(data.pm25 || 0);

        // 線條粗細（基於 AQI）
        const strokeWidth = config.strokeWidth + (data.aqi / 100) * 1.5;

        // 透明度（外圈較淡）
        const alpha = 0.3 + (index / config.ringCount) * 0.7;

        ctx.save();

        // 發光效果
        if (noiseIntensity > 0.3) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10 * noiseIntensity * config.glowIntensity;
        }

        ctx.strokeStyle = this._hexToRgba(color, alpha);
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();

        // 繪製帶噪點的圓
        const segments = 360;
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;

            // 計算噪點偏移
            let offset = 0;
            if (noiseIntensity > 0) {
                const nx = Math.cos(angle) * config.noiseScale + index * 0.1;
                const ny = Math.sin(angle) * config.noiseScale + time;
                offset = noise.fbm(nx, ny, 3, 0.5) * config.ringSpacing * noiseIntensity * 2;
            }

            const r = radius + offset;
            const x = center.x + Math.cos(angle) * r;
            const y = center.y + Math.sin(angle) * r;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.closePath();
        ctx.stroke();

        ctx.restore();
    }

    /**
     * 繪製中心圓
     * @param {object} currentData - 當前 AQI 資料
     */
    drawCenter(currentData) {
        if (!currentData) return;

        const ctx = this.ctx;
        const { center, config } = this;
        const color = this.getAqiColor(currentData.aqi);

        ctx.save();

        // 極簡風格：柔和漸層（更淡）
        const gradient = ctx.createRadialGradient(
            center.x, center.y, 0,
            center.x, center.y, config.baseRadius * 1.2
        );
        gradient.addColorStop(0, this._hexToRgba(color, 0.15));
        gradient.addColorStop(0.7, this._hexToRgba(color, 0.05));
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(center.x, center.y, config.baseRadius * 1.2, 0, Math.PI * 2);
        ctx.fill();

        // 中心細圓框
        ctx.strokeStyle = this._hexToRgba(color, 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(center.x, center.y, config.baseRadius * 0.85, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }

    /**
     * 主要渲染函數
     */
    render() {
        const ctx = this.ctx;
        const { size, data } = this;

        // 清除畫布
        ctx.clearRect(0, 0, size, size);

        // 背景（淺灰色，呼應純白極簡風格）
        ctx.fillStyle = '#FAFAFA';
        ctx.fillRect(0, 0, size, size);

        if (data.length === 0) return;

        // 繪製年輪（從外到內）
        const ringData = data.slice(-this.config.ringCount);
        for (let i = 0; i < ringData.length; i++) {
            this.drawRing(i, ringData[i]);
        }

        // 繪製中心
        const currentData = ringData[ringData.length - 1];
        this.drawCenter(currentData);
    }

    /**
     * M08: 開始動畫（帶幀率控制）
     */
    startAnimation() {
        const animate = (currentTime) => {
            this.animationFrame = requestAnimationFrame(animate);

            // M08: 幀率控制 - 跳過多餘的幀
            const deltaTime = currentTime - this.lastFrameTime;
            if (deltaTime < this.frameInterval) return;

            this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);

            this.time += this.config.noiseSpeed;
            this.render();
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * 停止動畫
     */
    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    /**
     * Hex 轉 RGBA
     */
    _hexToRgba(hex, alpha = 1) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * 銷毀
     */
    destroy() {
        this.stopAnimation();
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        window.removeEventListener('resize', this._resize);
    }
}

// 全域
window.RingsRenderer = RingsRenderer;
