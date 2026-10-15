/**
 * 调音器主逻辑（Web Audio API + YIN）
 * 支持：多乐器、多定弦、自定义定弦（Cookie 持久化）
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
  var COOKIE_CUSTOM = 'tuner_custom';
  var COOKIE_PREFS = 'tuner_prefs';
  var MIN_STRINGS = 2;
  var MAX_STRINGS = 8;
  var COOKIE_DAYS = 365;

  var el = {};
  var state = {
    instIndex: 0,
    tuningId: 'standard',
    lastTuning: {},   // { instrumentId: tuningId }
    a4: 440,
    useFlat: false,
    custom: {},       // { instrumentId: [{ id, name, strings:[midi], custom:true }] }
    strings: [],      // [{ midi, note, freq, freqText, thick }]
    rowEls: [],
    chipEls: [],
    tuned: {},
    smooth: null,
    stable: 0,
    lastVoice: 0,
    matched: -1,
    selected: -1,
    auto: true,
    minFreq: 40,
    listening: false,
    ctx: null,
    stream: null,
    proc: null,
    decim: 1,
    buf: null,
    filled: 0,
    tmp: null,
    editor: { open: false, editingId: null, name: '', midis: [] },
    flashTimer: null
  };

  /* ---------------- Cookie ---------------- */

  function setCookie(name, value) {
    var d = new Date();
    d.setTime(d.getTime() + COOKIE_DAYS * 864e5);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function readJSONCookie(name, fallback) {
    try {
      var raw = getCookie(name);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSONCookie(name, obj) {
    try {
      setCookie(name, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function savePrefs() {
    writeJSONCookie(COOKIE_PREFS, {
      inst: instruments[state.instIndex].id,
      tuning: state.tuningId,
      tunings: state.lastTuning,
      a4: state.a4,
      flat: state.useFlat
    });
  }

  function loadPrefs() {
    var p = readJSONCookie(COOKIE_PREFS, null);
    if (!p) return;
    var idx = indexOfInstrument(p.inst);
    if (idx >= 0) state.instIndex = idx;
    if (typeof p.a4 === 'number' && p.a4 >= 415 && p.a4 <= 466) state.a4 = p.a4;
    state.useFlat = !!p.flat;
    if (p.tunings && typeof p.tunings === 'object') state.lastTuning = p.tunings;
    var instId = instruments[state.instIndex].id;
    var want = p.tunings && p.tunings[instId] ? p.tunings[instId] : p.tuning;
    if (want) state.tuningId = want;
  }

  /* ---------------- 乐器 / 定弦 ---------------- */

  function indexOfInstrument(id) {
    for (var i = 0; i < instruments.length; i++) {
      if (instruments[i].id === id) return i;
    }
    return -1;
  }

  function getTunings(idx) {
    var inst = instruments[idx];
    var list = inst.tunings.slice();
    var custom = state.custom[inst.id] || [];
    return list.concat(custom);
  }

  function currentTuning() {
    var list = getTunings(state.instIndex);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.tuningId) return list[i];
    }
    return list[0];
  }

  function toMidi(v) {
    if (typeof v === 'number') return v;
    var m = music.noteToMidi(v);
    return m === null ? null : m;
  }

  function currentInstId() {
    return instruments[state.instIndex].id;
  }

  /* ---------------- 初始化 ---------------- */

  var initialised = false;

  function init() {
    if (initialised) return;
    initialised = true;

    el.chips = document.getElementById('instChips');
    el.tuningSelect = document.getElementById('tuningSelect');
    el.flatToggle = document.getElementById('flatToggle');
    el.customBtn = document.getElementById('customBtn');
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
    el.editor = document.getElementById('editor');
    el.tuningName = document.getElementById('tuningName');
    el.editorStrings = document.getElementById('editorStrings');
    el.addStringBtn = document.getElementById('addStringBtn');
    el.saveTuningBtn = document.getElementById('saveTuningBtn');
    el.cancelTuningBtn = document.getElementById('cancelTuningBtn');
    el.deleteTuningBtn = document.getElementById('deleteTuningBtn');

    state.custom = readJSONCookie(COOKIE_CUSTOM, {}) || {};
    loadPrefs();

    buildChips();
    buildA4Select();

    el.a4Select.value = String(state.a4);
    el.flatToggle.textContent = state.useFlat ? '♭' : '♯';

    el.tuningSelect.addEventListener('change', function () {
      state.tuningId = el.tuningSelect.value;
      state.lastTuning[currentInstId()] = state.tuningId;
      savePrefs();
      applySelection();
    });
    el.flatToggle.addEventListener('click', function () {
      state.useFlat = !state.useFlat;
      el.flatToggle.textContent = state.useFlat ? '♭' : '♯';
      el.flatToggle.classList.toggle('on', state.useFlat);
      savePrefs();
      applySelection();
    });
    el.customBtn.addEventListener('click', function () {
      if (state.editor.open) {
        closeEditor();
      } else {
        openEditor();
      }
    });
    el.addStringBtn.addEventListener('click', addString);
    el.saveTuningBtn.addEventListener('click', saveCustomTuning);
    el.cancelTuningBtn.addEventListener('click', closeEditor);
    el.deleteTuningBtn.addEventListener('click', deleteCustomTuning);

    el.modeChip.addEventListener('click', function () { setAuto(true); });
    el.a4Select.addEventListener('change', function () {
      state.a4 = parseInt(el.a4Select.value, 10);
      savePrefs();
      applySelection();
    });
    el.micBtn.addEventListener('click', toggleMic);

    applySelection();
  }

  function buildChips() {
    state.chipEls = [];
    for (var i = 0; i < instruments.length; i++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = instruments[idx].name;
        b.addEventListener('click', function () {
          if (idx === state.instIndex) return;
          state.instIndex = idx;
          var instId = instruments[idx].id;
          state.tuningId = state.lastTuning[instId] || getTunings(idx)[0].id;
          closeEditor();
          savePrefs();
          applySelection();
        });
        el.chips.appendChild(b);
        state.chipEls.push(b);
      })(i);
    }
  }

  function buildA4Select() {
    for (var v = 435; v <= 445; v++) {
      var o = document.createElement('option');
      o.value = String(v);
      o.textContent = 'A4 ' + v + ' Hz';
      el.a4Select.appendChild(o);
    }
  }

  /* ---------------- 应用当前选择 ---------------- */

  function applySelection() {
    var tun = currentTuning();
    var raw = tun.strings || [];
    var midis = [];
    for (var i = 0; i < raw.length; i++) {
      var m = toMidi(raw[i]);
      if (m !== null && m !== undefined) midis.push(m);
    }
    if (!midis.length) midis.push(40);

    var n = midis.length;
    var strings = [];
    var lowest = Infinity;
    for (var j = 0; j < n; j++) {
      var freq = music.midiToFreq(midis[j], state.a4);
      if (freq < lowest) lowest = freq;
      strings.push({
        midi: midis[j],
        note: music.midiToName(midis[j], state.useFlat),
        freq: freq,
        freqText: freq.toFixed(1),
        thick: Math.max(2, Math.round(7 - (j * 5) / Math.max(1, n - 1)))
      });
    }
    state.strings = strings;
    state.minFreq = Math.max(25, Math.floor(lowest * 0.85));
    state.matched = -1;
    state.selected = -1;
    state.smooth = null;
    state.stable = 0;

    if (state.chipEls) {
      for (var c = 0; c < state.chipEls.length; c++) {
        state.chipEls[c].className = 'chip' + (c === state.instIndex ? ' on' : '');
      }
    }

    renderTuningSelect();
    renderStrings();
    setAuto(true);
    resetDisplay();
  }

  function renderTuningSelect() {
    if (!el.tuningSelect) return;
    var list = getTunings(state.instIndex);
    el.tuningSelect.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var o = document.createElement('option');
      o.value = list[i].id;
      o.textContent = list[i].name + (list[i].custom ? '（自定义）' : '');
      el.tuningSelect.appendChild(o);
    }
    el.tuningSelect.value = currentTuning().id;
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
        row.addEventListener('click', function () { onTapString(idx); });
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
    var def = instruments[state.instIndex];
    var count = Math.min(state.rowEls.length, state.strings.length);
    for (var i = 0; i < count; i++) {
      var s = state.strings[i];
      if (!s) continue;
      var cls = 'string-row';
      if (state.tuned[tunedKey(def, s)]) cls += ' tuned';
      if (i === state.selected) cls += ' selected';
      state.rowEls[i].className = cls;
    }
  }

  function tunedKey(def, s) {
    return def.id + '|' + state.tuningId + '|' + s.midi;
  }

  /* ---------------- 自定义定弦编辑器 ---------------- */

  function openEditor() {
    var tun = currentTuning();
    var midis = [];
    for (var i = 0; i < tun.strings.length; i++) {
      var m = toMidi(tun.strings[i]);
      if (m !== null && m !== undefined) midis.push(m);
    }
    state.editor.open = true;
    state.editor.editingId = tun.custom ? tun.id : null;
    state.editor.name = tun.custom ? tun.name : '自定义定弦';
    state.editor.midis = midis;
    el.tuningName.value = state.editor.name;
    el.deleteTuningBtn.style.display = tun.custom ? '' : 'none';
    el.editor.hidden = false;
    el.customBtn.classList.add('on');
    renderEditor();
  }

  function closeEditor() {
    state.editor.open = false;
    el.editor.hidden = true;
    el.customBtn.classList.remove('on');
  }

  function renderEditor() {
    var wrap = el.editorStrings;
    wrap.innerHTML = '';
    var midis = state.editor.midis;
    for (var i = 0; i < midis.length; i++) {
      (function (idx) {
        var row = document.createElement('div');
        row.className = 'ed-row';

        var note = document.createElement('span');
        note.className = 'ed-note';
        note.textContent = music.midiToName(midis[idx], state.useFlat);

        var down = document.createElement('button');
        down.type = 'button';
        down.className = 'ed-btn';
        down.textContent = '♭−';
        down.title = '降低半音';

        var up = document.createElement('button');
        up.type = 'button';
        up.className = 'ed-btn';
        up.textContent = '♯+';
        up.title = '升高半音';

        var freq = document.createElement('span');
        freq.className = 'ed-freq';
        freq.textContent = music.midiToFreq(midis[idx], state.a4).toFixed(1) + ' Hz';

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'ed-btn ed-del';
        del.textContent = '✕';
        del.title = '删除此弦';

        down.addEventListener('click', function () { stepString(idx, -1); });
        up.addEventListener('click', function () { stepString(idx, 1); });
        del.addEventListener('click', function () { removeString(idx); });

        row.appendChild(note);
        row.appendChild(down);
        row.appendChild(up);
        row.appendChild(freq);
        row.appendChild(del);
        wrap.appendChild(row);
      })(i);
    }
  }

  function stepString(idx, delta) {
    var next = state.editor.midis[idx] + delta;
    if (next < 12 || next > 108) return;
    state.editor.midis[idx] = next;
    renderEditor();
  }

  function addString() {
    if (state.editor.midis.length >= MAX_STRINGS) {
      flash('最多 ' + MAX_STRINGS + ' 根弦');
      return;
    }
    var last = state.editor.midis[state.editor.midis.length - 1];
    state.editor.midis.push(typeof last === 'number' ? last : 40);
    renderEditor();
  }

  function removeString(idx) {
    if (state.editor.midis.length <= MIN_STRINGS) {
      flash('至少保留 ' + MIN_STRINGS + ' 根弦');
      return;
    }
    state.editor.midis.splice(idx, 1);
    renderEditor();
  }

  function saveCustomTuning() {
    var name = (el.tuningName.value || '').trim() || '自定义定弦';
    var instId = currentInstId();
    var list = state.custom[instId] || [];
    var id = state.editor.editingId || ('c' + Date.now());
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { found = list[i]; break; }
    }
    if (found) {
      found.name = name;
      found.strings = state.editor.midis.slice();
    } else {
      list.push({ id: id, name: name, strings: state.editor.midis.slice(), custom: true });
    }
    state.custom[instId] = list;
    if (!writeJSONCookie(COOKIE_CUSTOM, state.custom)) {
      flash('保存失败：浏览器禁用了 Cookie');
      return;
    }
    state.tuningId = id;
    state.lastTuning[instId] = id;
    savePrefs();
    closeEditor();
    applySelection();
    flash('已保存并使用「' + name + '」');
  }

  function deleteCustomTuning() {
    var instId = currentInstId();
    var id = state.editor.editingId;
    if (!id) return;
    var list = state.custom[instId] || [];
    var kept = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) kept.push(list[i]);
    }
    state.custom[instId] = kept;
    writeJSONCookie(COOKIE_CUSTOM, state.custom);
    state.tuningId = getTunings(state.instIndex)[0].id;
    state.lastTuning[instId] = state.tuningId;
    savePrefs();
    closeEditor();
    applySelection();
    flash('已删除该自定义定弦');
  }

  function flash(msg) {
    if (state.listening) return;
    el.hint.className = 'hint';
    el.hint.textContent = msg;
    if (state.flashTimer) clearTimeout(state.flashTimer);
    state.flashTimer = setTimeout(function () {
      el.hint.textContent = '点击「开始调音」并允许麦克风权限，然后逐根弹响琴弦。';
    }, 2600);
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
    if (Date.now() - state.lastVoice < HOLD_MS) return;
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
    var def = instruments[state.instIndex];
    var info = music.freqToNoteInfo(freq, state.a4, state.useFlat);
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

    var total = Math.min(state.rowEls.length, state.strings.length);
    for (var i = 0; i < total; i++) {
      var s = state.strings[i];
      if (!s) continue;
      var cls = 'string-row';
      if (state.tuned[tunedKey(def, s)]) cls += ' tuned';
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

  /** 每帧回调：抽取（降采样）后推入滑动分析缓冲 */
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
      if (bestAbs > 400) { // 与所有弦都相差太远，视为噪声
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
    var key = tunedKey(instruments[state.instIndex], target);
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
