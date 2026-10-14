/**
 * 乐理工具：音名 <-> MIDI <-> 频率（浏览器版）
 */
var MusicTheory = (function () {

  var SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function noteToMidi(note) {
    var m = /^([A-G])(#|b)?(-?\d+)$/.exec(String(note).toUpperCase());
    if (!m) return null;
    var v = SEMITONE[m[1]];
    if (m[2] === '#') v += 1;
    if (m[2] === 'b') v -= 1;
    return (parseInt(m[3], 10) + 1) * 12 + v;
  }

  function midiToFreq(midi, a4) {
    a4 = a4 || 440;
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  function noteToFreq(note, a4) {
    var midi = noteToMidi(note);
    if (midi === null) return 0;
    return midiToFreq(midi, a4);
  }

  function freqToNoteInfo(freq, a4) {
    a4 = a4 || 440;
    var midiFloat = 69 + 12 * Math.log2(freq / a4);
    var midiRound = Math.round(midiFloat);
    var cents = Math.round((midiFloat - midiRound) * 100);
    var idx = ((midiRound % 12) + 12) % 12;
    var octave = Math.floor(midiRound / 12) - 1;
    return { name: NAMES[idx] + octave, cents: cents };
  }

  return {
    noteToMidi: noteToMidi,
    midiToFreq: midiToFreq,
    noteToFreq: noteToFreq,
    freqToNoteInfo: freqToNoteInfo
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicTheory;
}
