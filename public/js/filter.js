/**
 * One Euro Filter (core/filter.py 포팅)
 */

function smoothingFactor(deltaTime, cutoff) {
    const r = 2 * Math.PI * cutoff * deltaTime;
    return r / (r + 1);
}

function exponentialSmoothing(alpha, x, xPrev) {
    return alpha * x + (1.0 - alpha) * xPrev;
}

export class OneEuroFilter {
    constructor(t0, x0, dx0 = 0.0, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
        this.minCutoff = Number(minCutoff);
        this.beta = Number(beta);
        this.dCutoff = Number(dCutoff);

        this.tPrev = Number(t0);
        this.xPrev = Number(x0);
        this.dxPrev = Number(dx0);
    }

    filter(t, x) {
        t = Number(t);
        x = Number(x);
        const deltaTime = t - this.tPrev;

        if (deltaTime <= 0) return this.xPrev;

        // 1. 속도 필터링
        const dx = (x - this.xPrev) / deltaTime;
        const alphaD = smoothingFactor(deltaTime, this.dCutoff);
        const dxHat = exponentialSmoothing(alphaD, dx, this.dxPrev);

        // 2. 가변 차단 주파수
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);

        // 3. 신호 필터링
        const alpha = smoothingFactor(deltaTime, cutoff);
        const xHat = exponentialSmoothing(alpha, x, this.xPrev);

        // 상태 업데이트
        this.tPrev = t;
        this.xPrev = xHat;
        this.dxPrev = dxHat;

        return xHat;
    }
}
