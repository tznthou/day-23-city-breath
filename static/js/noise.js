/**
 * Simplex Noise 實作
 * 用於產生年輪的有機扭曲效果
 *
 * 基於 Stefan Gustavson 的 Simplex Noise 演算法
 * https://weber.itn.liu.se/~stegu/simplexnoise/
 */

class SimplexNoise {
    constructor(seed = Math.random()) {
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);

        // 初始化排列表
        for (let i = 0; i < 256; i++) {
            this.p[i] = i;
        }

        // Fisher-Yates shuffle with seed
        let n = 256;
        let random = this._seededRandom(seed);
        while (n > 1) {
            const k = Math.floor(random() * n);
            n--;
            [this.p[n], this.p[k]] = [this.p[k], this.p[n]];
        }

        // 擴展排列表
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }

        // 梯度向量
        this.grad3 = [
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
        ];
    }

    _seededRandom(seed) {
        let s = seed;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    /**
     * 2D Simplex Noise
     * @param {number} x
     * @param {number} y
     * @returns {number} -1 到 1 之間的值
     */
    noise2D(x, y) {
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const G2 = (3 - Math.sqrt(3)) / 6;

        // Skew input space
        const s = (x + y) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);

        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = x - X0;
        const y0 = y - Y0;

        // 確定單純形
        let i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2;
        const y2 = y0 - 1 + 2 * G2;

        // 雜湊座標
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.permMod12[ii + this.perm[jj]];
        const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
        const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];

        // 計算三個角落的貢獻
        let n0 = 0, n1 = 0, n2 = 0;

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            t0 *= t0;
            n0 = t0 * t0 * this._dot2(this.grad3[gi0], x0, y0);
        }

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            t1 *= t1;
            n1 = t1 * t1 * this._dot2(this.grad3[gi1], x1, y1);
        }

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            t2 *= t2;
            n2 = t2 * t2 * this._dot2(this.grad3[gi2], x2, y2);
        }

        // 縮放到 [-1, 1]
        return 70 * (n0 + n1 + n2);
    }

    _dot2(g, x, y) {
        return g[0] * x + g[1] * y;
    }

    /**
     * Fractal Brownian Motion (多層疊加)
     * @param {number} x
     * @param {number} y
     * @param {number} octaves 層數
     * @param {number} persistence 持續度
     * @returns {number}
     */
    fbm(x, y, octaves = 4, persistence = 0.5) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.noise2D(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }

        return total / maxValue;
    }
}

// 全域實例
window.SimplexNoise = SimplexNoise;
