// Digital rain behind the page. Deliberately faint and slow: it is set dressing,
// the text in front has to stay readable. Off for reduced-motion users and while
// the tab is hidden.

const canvas = document.createElement('canvas');
canvas.className = 'rain';
canvas.setAttribute('aria-hidden', 'true');
document.body.prepend(canvas);

const ctx = canvas.getContext('2d');
const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
const size = 16;
let drops = [];

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const cols = Math.ceil(canvas.width / size);
  drops = Array.from({ length: cols }, () => Math.floor((Math.random() * canvas.height) / size));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function frame() {
  // Translucent black over the last frame leaves the fading trails.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${size}px monospace`;
  for (let i = 0; i < drops.length; i++) {
    const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
    const y = drops[i] * size;
    ctx.fillStyle = Math.random() < 0.04 ? '#ccffcc' : '#00c832';
    ctx.fillText(ch, i * size, y);
    if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
    else drops[i]++;
  }
}

const still = window.matchMedia('(prefers-reduced-motion: reduce)');
let timer = null;

function start() {
  if (timer || still.matches || document.hidden) return;
  timer = setInterval(frame, 70);
}

function stop() {
  clearInterval(timer);
  timer = null;
}

resize();
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
still.addEventListener?.('change', () => (still.matches ? stop() : start()));
start();
