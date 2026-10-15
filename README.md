# my_tuner

浏览器在线调音器。打开麦克风，实时识别音高，可视化显示每根弦的偏差。

🔗 在线使用：https://nantekoto.github.io/my_tuner/

## 功能

- **5 种乐器**：吉他、尤克里里、贝斯、小提琴、曼陀林
- **多套定弦**：吉他支持 Drop D / Drop C / DADGAD / Open G / Open D / 降半音 / 降全音；尤克里里支持 Low G / Baritone / D 调；贝斯支持五弦与 Drop D 等
- **自定义定弦**：每根弦可 ±半音微调、增删弦（2–8 根）、命名保存，数据存 Cookie（365 天）
- **琴弦可视化**：按真实粗细渲染，正在调的弦有振动动画，调准自动打勾
- **音分指针表**：±50 音分刻度，±5 音分内判定调准并震动提示
- **A4 校准**：435–445 Hz 可调；♯/♭ 显示可切换
- 记住上次使用的乐器与定弦

## 使用

直接用浏览器打开 `index.html` 即可，无需构建。建议用 Chrome / Safari，需授权麦克风权限（微信内置浏览器支持不稳定）。

**部署到 GitHub Pages**：Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。Pages 提供 HTTPS，是麦克风权限生效的前提。

## 实现

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式 |
| `app.js` | 音频采集与界面逻辑 |
| `pitch.js` | YIN 音高检测 |
| `music.js` | 音名 / 频率 / 音分换算 |
| `instruments.js` | 乐器与定弦定义 |

Web Audio API 采集麦克风输入，优先 16 kHz，不支持时按 `round(采样率/16000)` 降采样；滑动窗口保留最近 4096 样本（约 256 ms）送入 YIN 算法（差分函数 + 累积均值归一化 + 抛物线插值）。实测 41 Hz（贝斯 B0）到 660 Hz（小提琴 E5）误差 < 2 音分。

新增乐器或定弦只需在 `instruments.js` 中追加一条记录。
