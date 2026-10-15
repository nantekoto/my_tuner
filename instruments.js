/**
 * 乐器与定弦定义
 * 内置定弦用音名（如 'E2'、'Eb2'），用户自定义定弦用 MIDI 音号存储
 */
var INSTRUMENTS = [
  {
    id: 'guitar',
    name: '吉他',
    tunings: [
      { id: 'standard', name: '标准 EADGBE', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'drop-d', name: 'Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'drop-c', name: 'Drop C', strings: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
      { id: 'dadgad', name: 'DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
      { id: 'open-g', name: 'Open G', strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
      { id: 'open-d', name: 'Open D', strings: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
      { id: 'half-down', name: '降半音 Eb', strings: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
      { id: 'full-down', name: '降全音 D', strings: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] }
    ]
  },
  {
    id: 'ukulele',
    name: '尤克里里',
    tunings: [
      { id: 'standard', name: '标准 GCEA（High G）', strings: ['G4', 'C4', 'E4', 'A4'] },
      { id: 'low-g', name: 'Low G', strings: ['G3', 'C4', 'E4', 'A4'] },
      { id: 'baritone', name: 'Baritone DGBE', strings: ['D3', 'G3', 'B3', 'E4'] },
      { id: 'd-tuning', name: 'D 调 ADF#B', strings: ['A4', 'D4', 'F#4', 'B4'] },
      { id: 'half-down', name: '降半音', strings: ['Gb4', 'B3', 'Eb4', 'Ab4'] }
    ]
  },
  {
    id: 'bass',
    name: '贝斯',
    tunings: [
      { id: 'standard', name: '标准 EADG', strings: ['E1', 'A1', 'D2', 'G2'] },
      { id: 'drop-d', name: 'Drop D', strings: ['D1', 'A1', 'D2', 'G2'] },
      { id: 'five', name: '五弦 BEADG', strings: ['B0', 'E1', 'A1', 'D2', 'G2'] },
      { id: 'half-down', name: '降半音', strings: ['Eb1', 'Ab1', 'Db2', 'Gb2'] }
    ]
  },
  {
    id: 'violin',
    name: '小提琴',
    tunings: [
      { id: 'standard', name: '标准 GDAE', strings: ['G3', 'D4', 'A4', 'E5'] },
      { id: 'scordatura', name: '变格定弦 GDAEb', strings: ['G3', 'D4', 'A4', 'Eb5'] }
    ]
  },
  {
    id: 'mandolin',
    name: '曼陀林',
    tunings: [
      { id: 'standard', name: '标准 GDAE', strings: ['G3', 'D4', 'A4', 'E5'] }
    ]
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = INSTRUMENTS;
}
