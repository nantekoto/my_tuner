/**
 * 调音器主逻辑（Web Audio API + YIN）
 */
(function () {
  var pitch = window.PitchDetector;
  var music = window.MusicTheory;
  var instruments = window.INSTRUMENTS;

  var TARGET_RATE = 16000;      // 目标分析采样率
  var ANALYSIS_SAMPLES = 4096;  // 分析窗口（约 256ms @16k）
  var BLOCK_SIZE = 4096;        // ScriptProcessor 帧大小（必须为 2 的幂）
  var RMS_GATE = 0.008;         // 静音门槛
  var HOLD_MS = 700;            // 声音消失后读数保持时间

  var el = {};
  var state = {
    instrumentIndex: 0,
    a4: 440,
    auto: true,
    selected: -1,
    strings: [],
    rowEls: [],
    tuned: {},
    smooth: null,
    stable: 0,
    lastVoice: 0,
    matched: -1,
    minFreq: 40,
    listening: false,
    ctx: null,
    stream: null,
    proc: null,
    decim: 1,
    buf: null,
    filled: 0,
    tmp: null
  };

  /* ---------------- 初始化 ---------------- */

  function init() {
    el.chips = document.getElementById('instChips');
    el.stringsWrap = document.getElementById('stringsWrap');
    el.modeChip = document.getElementById('modeChip');
    el.noteBig = document.getElementById('noteBig');
    el.freqText = document.getElementById('freqText');
    el.needle = document.getElementById('needle');
    el.status = document.getElementById('statusText');
    el.level = document.getElementById('levelFill');
    el.a4Select = document.getElementById('a4Select');
    el.micBtn = document.getElementById('micBtn');
    el.hint = document.getElementById('hint');

    buildChips();
    buildA4Select();
    applyInstrument(0);

    el.modeChip.addEventListener('click', function () {
      setAuto(true);
    });
    el.a4Select.addEventListener('change', function () {
      state.a4 = parseInt(el.a4Select.value, 10);
      state.tuned = {};
      applyInstrument(state.instrumentIndex);
    });
    el.micBtn.addEventListener('click', toggleMic);
  }

  function buildChips() {
    for (var i = 0; i < instruments.length; i++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (idx === 0 ? ' on' : '');
        b.textContent = instruments[idx].name;
        b.addEventListener('click', function () {
          if (idx === state.instrumentIndex) return;
          applyInstrument(idx);
        });
        el.chips.appendChild(b);
        if (!state.chipEls) state.chipEls = [];
        state.chipEls.push(b);
      })(i);
    }
  }

  function buildA4Select() {
    for (var v = 435; v <= 445; v++) {
      var o = document.createElement('option');
      o.value = String(v);
      o.textContent = 'A4 ' + v + ' Hz';
      if (v === 440) o.selected = true;
      el.a4Select.appendChild(o);
    }
  }

  /* ---------------- 乐器与琴弦 ---------------- */

  function applyInstrument(index) {
    state.instrumentIndex = index;
    var def = instruments[index];
    var n = def.strings.length;
    var strings = [];
    var lowest = Infinity;
    for (var i = 0; i < n; i++) {
      var note = def.strings[i];
      var f = music.noteToFreq(note, state.a4);
      if (f < lowest) lowest = f;
      strings.push({
        note: note,
        freq: f,
        freqText: f.toFixed(1),
        thick: Math.max(2, Math.round(7 - (i * 5) / Math.max(1, n - 1)))
      });
    }
    state.strings = strings;
    state.minFreq = Math.max(28, Math.floor(lowest * 0.85));
    state.matched = -1;
    state.selected = -1;
    state.smooth = null;
    state.stable = 0;

    if (state.chipEls) {
      for (var c = 0; c < state.chipEls.length; c++) {
        state.chipEls[c].className = 'chip' + (c === index ? ' on' : '');
      }
    }

    renderStrings();      // 先按新乐器重建琴弦 DOM
    setAuto(true);        // 再刷新模式与选中态
    resetDisplay();
  }

  function renderStrings() {
    el.stringsWrap.innerHTML = '';
    state.rowEls = [];
    for (var i = 0; i < state.strings.length; i++) {
      var s = state.strings[i];
      var row = document.createElement('div');
      row.className = 'string-row';
      row.innerHTML =
        '<span class="s-note">' + s.note + '</span>' +
        '<span class="s-line" style="height:' + s.thick + 'px"></span>' +
        '<span class="s-freq">' + s.freqText + '</span>' +
        '<span class="s-check">✓</span>';
      (function (idx) {
        row.addEventListener('click', function () {
          onTapString(idx);
        });
      })(i);
      el.stringsWrap.appendChild(row);
      state.rowEls.push(row);
    }
    refreshStringClasses();
  }

  function onTapString(idx) {
    if (!state.auto && state.selected === idx) {
      setAuto(true);
    } else {
      setAuto(false, idx);
    }
  }

  function setAuto(flag, idx) {
    state.auto = !!flag;
    state.selected = flag ? -1 : (typeof idx === 'number' ? idx : 0);
    state.smooth = null;
    state.stable = 0;
    el.modeChip.textContent = state.auto
      ? '自动识别 · 点琴弦可锁定'
      : '手动 · ' + (state.strings[state.selected] ? state.strings[state.selected].note : '') + '（点此恢复自动）';
    refreshStringClasses();
  }

  function refreshStringClasses() {
    var def = instruments[state.instrumentIndex];
    var count = Math.min(state.rowEls.length, state.strings.length);
    for (var i = 0; i < count; i++) {
      var s = state.strings[i];
      if (!s) continue;
      var cls = 'string-row';
      if (state.tuned[def.id + '|' + s.note]) cls += ' tuned';
      if (i === state.selected) cls += ' selected';
      state.rowEls[i].className = cls;
    }
  }

  /* ---------------- 显示 ---------------- */

  function resetDisplay() {
    el.noteBig.textContent = '--';
    el.noteBig.classList.remove('ok');
    el.freqText.textContent = '弹响一根琴弦';
    el.needle.style.left = '50%';
    el.status.className = 'status idle';
    el.status.textContent = state.listening ? '等待声音…' : '点击下方按钮开始';
  }

  function setIdle(level) {
    el.level.style.width = level + '%';
    var now = Date.now();
    if (now - state.lastVoice < HOLD_MS) return;
    if (state.matched !== -1) {
      state.matched = -1;
      state.smooth = null;
      refreshStringClasses();
    }
    el.noteBig.textContent = '--';
    el.noteBig.classList.remove('ok');
    el.freqText.textContent = '弹响一根琴弦';
    el.needle.style.left = '50%';
    el.status.className = 'status idle';
    el.status.textContent = '等待声音…';
  }

  function updateDisplay(freq, cents, level) {
    var def = instruments[state.instrumentIndex];
    var info = music.freqToNoteInfo(freq, state.a4);
    var inTune = Math.abs(cents) <= 5;

    el.noteBig.textContent = info.name;
    if (inTune) {
      el.noteBig.classList.add('ok');
    } else {
      el.noteBig.classList.remove('ok');
    }
    el.freqText.textContent = freq.toFixed(1) + ' Hz';
    el.needle.style.left = Math.max(0, Math.min(100, cents + 50)) + '%';
    el.level.style.width = level + '%';

    if (cents <= -6) {
      el.status.className = 'status low';
      el.status.textContent = '偏低 ' + Math.abs(cents) + '¢ · 旋紧弦钮';
    } else if (cents >= 6) {
      el.status.className = 'status high';
      el.status.textContent = '偏高 ' + cents + '¢ · 放松弦钮';
    } else {
      el.status.className = 'status ok';
      el.status.textContent = '已调准 ✓';
    }

    // 琴弦状态刷新
    var total = Math.min(state.rowEls.length, state.strings.length);
    for (var i = 0; i < total; i++) {
      var s = state.strings[i];
      if (!s) continue;
      var cls = 'string-row';
      if (state.tuned[def.id + '|' + s.note]) cls += ' tuned';
      if (i === state.selected) cls += ' selected';
      if (i === state.matched) cls += ' matching';
      state.rowEls[i].className = cls;
      var line = state.rowEls[i].querySelector('.s-line');
      if (line) {
        line.className = 's-line' + (i === state.matched ? ' vibrating' : '');
        line.style.height = s.thick + 'px';
      }
    }
  }

  /* ---------------- 音频采集与分析 ---------------- */

  function toggleMic() {
    if (state.listening) {
      stopAudio();
    } else {
      startAudio();
    }
  }

  function startAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.hint.className = 'hint error';
      el.hint.textContent = '当前环境不支持麦克风录音，请使用 HTTPS 页面并在手机/桌面浏览器中打开。';
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }).then(function (stream) {
      state.stream = stream;
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx;
      try {
        ctx = new AC({ sampleRate: TARGET_RATE });
      } catch (e) {
        ctx = new AC();
      }
      state.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      var rate = ctx.sampleRate || TARGET_RATE;
      state.decim = Math.max(1, Math.round(rate / TARGET_RATE));
      state.buf = new Float32Array(ANALYSIS_SAMPLES);
      state.filled = 0;
      state.tmp = null;

      var source = ctx.createMediaStreamSource(stream);
      var proc = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
      proc.onaudioprocess = onAudioProcess;
      source.connect(proc);
      var mute = ctx.createGain();
      mute.gain.value = 0;
      proc.connect(mute);
      mute.connect(ctx.destination);
      state.proc = proc;

      state.listening = true;
      state.smooth = null;
      state.stable = 0;
      state.lastVoice = 0;
      el.micBtn.textContent = '停止';
      el.micBtn.classList.add('on');
      el.hint.className = 'hint';
      el.hint.textContent = '正在聆听：逐根弹响琴弦，指针进入绿色区域即调准。';
      resetDisplay();
    }).catch(function (err) {
      el.hint.className = 'hint error';
      el.hint.textContent = '无法访问麦克风：' + ((err && err.name) || err) + '。请允许麦克风权限，并确保通过 HTTPS 打开页面。';
    });
  }

  function stopAudio() {
    if (state.proc) {
      try { state.proc.disconnect(); } catch (e) {}
      state.proc = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
    if (state.ctx) {
      try { state.ctx.close(); } catch (e) {}
      state.ctx = null;
    }
    state.listening = false;
    state.matched = -1;
    el.micBtn.textContent = '开始调音';
    el.micBtn.classList.remove('on');
    el.hint.className = 'hint';
    el.hint.textContent = '点击「开始调音」并允许麦克风权限，然后逐根弹响琴弦。';
    resetDisplay();
    refreshStringClasses();
  }

  /** 每帧回调：把采集到的块抽取（降采样）后推入滑动分析缓冲 */
  function onAudioProcess(e) {
    var buf = state.buf;
    if (!buf) return;
    var input = e.inputBuffer.getChannelData(0);
    var decim = state.decim;
    var n = Math.floor(input.length / decim);
    if (n <= 0) return;

    if (!state.tmp || state.tmp.length !== n) state.tmp = new Float32Array(n);
    var dec = state.tmp;
    for (var i = 0; i < n; i++) {
      var acc = 0;
      var base = i * decim;
      for (var k = 0; k < decim; k++) acc += input[base + k];
      dec[i] = acc / decim; // N 点平均，兼作简易抗混叠低通
    }

    // 滑动窗口：整体左移后把新块接到尾部，保证缓冲内为最新数据
    var shift = Math.min(n, buf.length);
    buf.copyWithin(0, shift);
    buf.set(dec, buf.length - shift);
    state.filled = Math.min(buf.length, state.filled + n);

    if (state.filled < buf.length) return; // 缓冲填满后再开始分析
    analyze(buf);
  }

  function analyze(samples) {
    var count = samples.length;
    var rms = 0;
    for (var i = 0; i < count; i++) rms += samples[i] * samples[i];
    rms = Math.sqrt(rms / count);
    var level = Math.min(100, Math.round(rms * 600));

    if (rms < RMS_GATE) {
      setIdle(level);
      return;
    }

    var effRate = (state.ctx ? state.ctx.sampleRate : TARGET_RATE) / state.decim;
    var res = pitch.detectPitch(samples, effRate, {
      minFreq: state.minFreq,
      maxFreq: 1100,
      threshold: 0.15
    });
    if (!res) {
      setIdle(level);
      return;
    }

    var freq = res.freq;
    var strings = state.strings;
    var targetIndex = -1;
    if (state.auto) {
      var bestAbs = Infinity;
      for (var s = 0; s < strings.length; s++) {
        var c0 = 1200 * Math.log2(freq / strings[s].freq);
        if (Math.abs(c0) < bestAbs) {
          bestAbs = Math.abs(c0);
          targetIndex = s;
        }
      }
      if (bestAbs > 400) {
        setIdle(level);
        return;
      }
    } else {
      targetIndex = state.selected >= 0 ? state.selected : 0;
    }

    var target = strings[targetIndex];
    var rawCents = 1200 * Math.log2(freq / target.freq);
    state.smooth = state.smooth === null ? rawCents : state.smooth * 0.6 + rawCents * 0.4;
    var cents = Math.round(state.smooth);
    var inTune = Math.abs(cents) <= 5;

    if (inTune) {
      state.stable++;
    } else {
      state.stable = 0;
    }
    var key = instruments[state.instrumentIndex].id + '|' + target.note;
    if (state.stable >= 3 && !state.tuned[key]) {
      state.tuned[key] = true;
      if (navigator.vibrate) navigator.vibrate(30);
    }

    state.lastVoice = Date.now();
    state.matched = targetIndex;
    updateDisplay(freq, cents, level);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
