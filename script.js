"use strict";
// Android / iOS: original QR flip interaction.
const btnAndroid = document.getElementById('btn-android');
const btnIos = document.getElementById('btn-ios');
const qrCardInner = document.getElementById('qr-card-inner');
function setPlatform(ios) {
  if (!btnAndroid || !btnIos || !qrCardInner) return;
  btnAndroid.classList.toggle('active', !ios);
  btnIos.classList.toggle('active', ios);
  qrCardInner.classList.toggle('flipped', ios);
  btnAndroid.setAttribute('aria-pressed', String(!ios));
  btnIos.setAttribute('aria-pressed', String(ios));
}
btnIos?.addEventListener('click', () => setPlatform(true));
btnAndroid?.addEventListener('click', () => setPlatform(false));
setPlatform(false);

// Scroll header/progress and scroll-to-top.
const scrollTopBtn = document.getElementById('scrollTopBtn');
const header = document.querySelector('.navbar');
const scrollProgress = document.getElementById('scroll-progress');
let scrollQueued = false;
function updateScrollUI() {
  scrollTopBtn?.classList.toggle('show', window.scrollY > 300);
  header?.classList.toggle('scrolled', window.scrollY > 35);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollProgress) scrollProgress.style.width = `${max > 0 ? Math.min(100, window.scrollY / max * 100) : 0}%`;
  scrollQueued = false;
}
window.addEventListener('scroll', () => {
  if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScrollUI); }
}, {passive:true});
window.addEventListener('resize', updateScrollUI);
scrollTopBtn?.addEventListener('click', () => window.scrollTo({top:0,behavior:'smooth'}));
updateScrollUI();

// Original reveal observer.
const revealed = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), {threshold:.08});
  revealed.forEach(el => observer.observe(el));
} else revealed.forEach(el => el.classList.add('visible'));

// Stable typing: only the heading types. The real heading stays in the
// layout, preventing line-wrap jumps. Paragraph content is always preserved.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let typingSession = 0;
let typingFrame = null;
let activeHeading = null;

function stopManualTyping() {
  ++typingSession;
  if (typingFrame !== null) cancelAnimationFrame(typingFrame);
  typingFrame = null;
  if (activeHeading) {
    activeHeading.classList.remove('manual-typing');
    activeHeading.querySelector('.manual-typed-overlay')?.remove();
    activeHeading = null;
  }
  document.querySelectorAll('.manual-copy p.manual-description-enter').forEach(el => {
    el.classList.remove('manual-description-enter');
  });
}

function typeManualText(slide) {
  stopManualTyping();
  if (!slide || reducedMotion.matches) return;
  const heading = slide.querySelector('.manual-copy h3');
  const paragraph = slide.querySelector('.manual-copy p');
  if (!heading) return;

  const fullText = heading.textContent;
  const chars = Array.from(fullText);
  if (!chars.length) return;

  const overlay = document.createElement('span');
  overlay.className = 'manual-typed-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  heading.appendChild(overlay);
  heading.classList.add('manual-typing');
  activeHeading = heading;
  const mySession = typingSession;
  const charDuration = 28; // Fast enough for a short user manual.
  let begin = null;
  let previousCount = -1;

  function finish() {
    if (mySession !== typingSession) return;
    heading.classList.remove('manual-typing');
    overlay.remove();
    activeHeading = null;
    typingFrame = null;
    if (paragraph) {
      paragraph.classList.remove('manual-description-enter');
      void paragraph.offsetWidth; // Restart only the gentle paragraph reveal.
      paragraph.classList.add('manual-description-enter');
      paragraph.addEventListener('animationend', () => paragraph.classList.remove('manual-description-enter'), {once:true});
    }
  }

  function tick(timestamp) {
    if (mySession !== typingSession) return;
    if (begin === null) begin = timestamp;
    const count = Math.min(chars.length, Math.floor((timestamp - begin) / charDuration) + 1);
    if (count !== previousCount) {
      // textContent is safe: no HTML parsing, no changes to the real heading.
      overlay.textContent = chars.slice(0,count).join('');
      previousCount = count;
    }
    if (count < chars.length) typingFrame = requestAnimationFrame(tick);
    else finish();
  }
  typingFrame = requestAnimationFrame(tick);
}

// Screenshot manual: independent sequences for mobile and website.
const manuals = ['game','web'];
const positions = {game:0,web:0};
let selectedManual = 'game';
const dotsHolder = document.getElementById('manual-dots');
const indexLabel = document.getElementById('manual-index');
function renderManual() {
  manuals.forEach(name => {
    const panel = document.getElementById(`panel-${name}`);
    const tab = document.getElementById(`tab-${name}`);
    const active = name === selectedManual;
    if (panel) panel.hidden = !active;
    tab?.classList.toggle('active',active);
    tab?.setAttribute('aria-selected',String(active));
    panel?.querySelectorAll('.manual-slide').forEach((slide,index) => {
      const visible = index === positions[name];
      slide.classList.toggle('current', visible);
      slide.classList.remove('manual-enter-forward','manual-enter-backward','manual-exit-forward','manual-exit-backward');
      slide.setAttribute('aria-hidden', String(!visible));
    });
  });
  const slides = [...document.querySelectorAll(`#panel-${selectedManual} .manual-slide`)];
  const idx = positions[selectedManual];
  if (indexLabel) indexLabel.textContent = String(idx + 1).padStart(2,'0');
  if (dotsHolder) {
    dotsHolder.replaceChildren();
    slides.forEach((_,n) => {
      const dot = document.createElement('button');
      dot.type='button';
      dot.className='manual-dot' + (n === idx ? ' active' : '');
      dot.setAttribute('aria-label', `Go to step ${n+1}`);
      dot.setAttribute('aria-current', String(n===idx));
      dot.addEventListener('click', () => { positions[selectedManual]=n; renderManual(); });
      dotsHolder.appendChild(dot);
    });
  }
  typeManualText(slides[idx]);
}
function moveManual(step) {
  const length=document.querySelectorAll(`#panel-${selectedManual} .manual-slide`).length;
  if (!length) return;
  positions[selectedManual]=(positions[selectedManual]+step+length)%length;
  renderManual();
}
manuals.forEach(name => document.getElementById(`tab-${name}`)?.addEventListener('click', () => {
  selectedManual=name; renderManual();
}));
document.getElementById('manual-prev')?.addEventListener('click', () => moveManual(-1));
document.getElementById('manual-next')?.addEventListener('click', () => moveManual(1));
const shell=document.querySelector('.manual-shell');
shell?.addEventListener('keydown', e => {
  if (e.key==='ArrowLeft'||e.key==='ArrowRight') {
    e.preventDefault(); moveManual(e.key==='ArrowRight'?1:-1);
  }
});
let touchX=null;
const panels=document.querySelector('.manual-panels');
panels?.addEventListener('touchstart', e => { touchX=e.changedTouches[0]?.screenX??null; }, {passive:true});
panels?.addEventListener('touchend', e => {
  if (touchX===null)return;
  const delta=(e.changedTouches[0]?.screenX??touchX)-touchX;
  if (Math.abs(delta)>55)moveManual(delta<0?1:-1);
  touchX=null;
}, {passive:true});
renderManual();
