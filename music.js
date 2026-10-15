/**
 * 乐理工具：音名 <-> MIDI <-> 频率（网页版）
 */
var MusicTheory = (function () {

  var SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  var SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  function noteToMidi(note) {
    var m = /^([A-Ga-g])([#b])?(-?\d+)$/.exec(String(note).trim());
    if (!m) return null;
    var v = SEMITONE[m[1].toUpperCase()];
    if (v === undefined) return null;
    if (m[2] === '#') v += 1;
    if (m[2] === 'b') v -= 1;
    return (parseInt(m[3], 10) + 1) * 12 + v;
  }

  function midiToName(midi, useFlat) {
    var names = useFlat ? FLAT : SHARP;
    var idx = ((midi % 12) + 12) % 12;
    var octave = Math.floor(midi / 12) - 1;
    return names[idx] + octave;
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

  function freqToNoteInfo(freq, a4, useFlat) {
    a4 = a4 || 440;
    var midiFloat = 69 + 12 * Math.log2(freq / a4);
    var midiRound = Math.round(midiFloat);
    var cents = Math.round((midiFloat - midiRound) * 100);
    return { name: midiToName(midiRound, useFlat), cents: cents };
  }

  return {
    noteToMidi: noteToMidi,
    midiToName: midiToName,
    midiToFreq: midiToFreq,
    noteToFreq: noteToFreq,
    freqToNoteInfo: freqToNoteInfo
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicTheory;
}
