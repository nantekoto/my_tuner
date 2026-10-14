/**
 * YIN 音高检测算法（浏览器版）
 * 输入：Float32Array 采样数据、采样率、搜索范围
 * 输出：{ freq, clarity }，无法检测返回 null
 */
var PitchDetector = (function () {

  function detectPitch(buffer, sampleRate, opts) {
    opts = opts || {};
    var threshold = opts.threshold || 0.15;
    var minFreq = opts.minFreq || 55;
    var maxFreq = opts.maxFreq || 1100;

    var N = buffer.length;
    var W = Math.floor(N / 2);
    var tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    var tauMax = Math.min(Math.floor(sampleRate / minFreq), W - 1);
    if (tauMax <= tauMin) return null;

    // 差分函数 d(tau)
    var d = new Float32Array(tauMax + 1);
    for (var tau = tauMin; tau <= tauMax; tau++) {
      var sum = 0;
      for (var i = 0; i < W; i++) {
        var diff = buffer[i] - buffer[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // 累积均值归一化差分函数 d'(tau)
    var d2 = new Float32Array(tauMax + 1);
    var running = 0;
    for (var t = 1; t <= tauMax; t++) {
      running += d[t];
      d2[t] = running === 0 ? 1 : (d[t] * t) / running;
    }

    // 第一个低于阈值的谷底；否则退回全局最小值
    var tauEst = -1;
    var t1 = tauMin;
    var found = false;
    while (t1 <= tauMax) {
      if (d2[t1] < threshold) {
        while (t1 + 1 <= tauMax && d2[t1 + 1] < d2[t1]) t1++;
        tauEst = t1;
        found = true;
        break;
      }
      t1++;
    }
    if (!found) {
      var best = Infinity;
      for (var t2 = tauMin; t2 <= tauMax; t2++) {
        if (d2[t2] < best) {
          best = d2[t2];
          tauEst = t2;
        }
      }
      if (best > 0.5) return null;
    }

    // 抛物线插值，提高音分精度
    var betterTau = tauEst;
    if (tauEst > tauMin && tauEst < tauMax) {
      var s0 = d2[tauEst - 1];
      var s1 = d2[tauEst];
      var s2 = d2[tauEst + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
    }

    var freq = sampleRate / betterTau;
    var clarity = 1 - d2[tauEst];
    if (clarity < 0.5) return null;
    return { freq: freq, clarity: clarity };
  }

  return { detectPitch: detectPitch };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PitchDetector;
}
