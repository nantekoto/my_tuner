/**
 * 乐器标准调弦定义（从上/最粗到下）
 */
var INSTRUMENTS = [
  { id: 'guitar', name: '吉他', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'ukulele', name: '尤克里里', strings: ['G4', 'C4', 'E4', 'A4'] },
  { id: 'bass', name: '贝斯', strings: ['E1', 'A1', 'D2', 'G2'] },
  { id: 'violin', name: '小提琴', strings: ['G3', 'D4', 'A4', 'E5'] },
  { id: 'mandolin', name: '曼陀林', strings: ['G3', 'D4', 'A4', 'E5'] }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = INSTRUMENTS;
}
