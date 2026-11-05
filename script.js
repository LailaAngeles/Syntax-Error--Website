"use strict";
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

// Manual player: two independent sequences (mobile game, website portal) shown like a short video.
// Each step is a chapter; the player advances on its own, pauses when hidden, and never autoplays
// for people who prefer reduced motion.
const manuals = ['game','web'];
const positions = {game:0,web:0};
let selectedManual = 'game';
const STEP_MS = 9000;
const dotsHolder = document.getElementById('manual-dots');
const indexLabel = document.getElementById('manual-index');
const timeLabel = document.getElementById('manual-time');
const playButton = document.getElementById('manual-play');
const shell = document.querySelector('.manual-shell');
let playing = false, userPaused = reducedMotion.matches, inView = false, ended = false;
let elapsed = 0, lastTick = null, frame = null;

const stepCount = () => document.querySelectorAll(`#panel-${selectedManual} .manual-slide`).length;
const clockText = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function paintProgress() {
  const idx = positions[selectedManual];
  dotsHolder?.querySelectorAll('.manual-chapter').forEach((chapter, n) => {
    const p = n < idx ? 100 : n > idx ? 0 : Math.min(100, elapsed / STEP_MS * 100);
    chapter.style.setProperty('--p', p + '%');
  });
  if (timeLabel) timeLabel.textContent = `${clockText(idx * STEP_MS + elapsed)} / ${clockText(stepCount() * STEP_MS)}`;
}

function setPlayButton() {
  if (!playButton) return;
  const icon = ended ? 'bi-arrow-counterclockwise' : playing ? 'bi-pause-fill' : 'bi-play-fill';
  playButton.innerHTML = `<i class="bi ${icon}"></i>`;
  playButton.setAttribute('aria-label', ended ? 'Replay walkthrough' : playing ? 'Pause walkthrough' : 'Play walkthrough');
  shell?.classList.toggle('is-paused', !playing);
}

function tick(now) {
  if (!playing) { frame = null; return; }
  if (lastTick !== null) elapsed += now - lastTick;
  lastTick = now;
  if (elapsed >= STEP_MS) {
    if (positions[selectedManual] >= stepCount() - 1) { elapsed = STEP_MS; paintProgress(); ended = true; stop(); return; }
    positions[selectedManual]++;
    elapsed = 0;
    renderManual(false);
  }
  paintProgress();
  frame = requestAnimationFrame(tick);
}
function start() {
  if (playing) return;
  if (ended) { ended = false; positions[selectedManual] = 0; elapsed = 0; renderManual(false); }
  playing = true; lastTick = null; setPlayButton();
  frame = requestAnimationFrame(tick);
}
function stop() {
  playing = false; lastTick = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null; setPlayButton();
}
function syncAutoplay() { (inView && !userPaused && !document.hidden && !ended) ? start() : stop(); }

function renderManual(resetTime = true) {
  if (resetTime) { elapsed = 0; ended = false; }
  manuals.forEach(name => {
    const panel = document.getElementById(`panel-${name}`);
    const tab = document.getElementById(`tab-${name}`);
    const active = name === selectedManual;
    if (panel) panel.hidden = !active;
    tab?.classList.toggle('active',active);
    tab?.setAttribute('aria-selected',String(active));
    panel?.querySelectorAll('.manual-slide').forEach((slide,index) => {
      const visible = active && index === positions[name];
      // Re-adding "current" restarts the step's animations from the beginning.
      slide.classList.remove('current');
      if (visible) { void slide.offsetWidth; slide.classList.add('current'); }
      slide.classList.remove('manual-enter-forward','manual-enter-backward','manual-exit-forward','manual-exit-backward');
      slide.setAttribute('aria-hidden', String(!visible));
    });
  });
  const slides = [...document.querySelectorAll(`#panel-${selectedManual} .manual-slide`)];
  const idx = positions[selectedManual];
  if (indexLabel) indexLabel.textContent = String(idx + 1).padStart(2,'0');
  if (dotsHolder) {
    dotsHolder.replaceChildren();
    slides.forEach((slide,n) => {
      const chapter = document.createElement('button');
      chapter.type = 'button';
      chapter.className = 'manual-chapter' + (n === idx ? ' active' : '');
      const title = slide.querySelector('.manual-copy h3')?.textContent.trim() || `Step ${n + 1}`;
      chapter.title = `${n + 1}. ${title}`;
      chapter.setAttribute('aria-label', `Chapter ${n + 1}: ${title}`);
      chapter.setAttribute('aria-current', String(n === idx));
      chapter.append(document.createElement('span'));
      chapter.addEventListener('click', () => { positions[selectedManual] = n; renderManual(); syncAutoplay(); });
      dotsHolder.appendChild(chapter);
    });
  }
  setPlayButton();
  paintProgress();
  typeManualText(slides[idx]);
}
function moveManual(step) {
  const length = stepCount();
  if (!length) return;
  positions[selectedManual] = (positions[selectedManual] + step + length) % length;
  renderManual();
  syncAutoplay();
}
manuals.forEach(name => document.getElementById(`tab-${name}`)?.addEventListener('click', () => {
  selectedManual = name; positions[name] = 0; renderManual(); syncAutoplay();
}));
document.getElementById('manual-prev')?.addEventListener('click', () => moveManual(-1));
document.getElementById('manual-next')?.addEventListener('click', () => moveManual(1));
playButton?.addEventListener('click', () => {
  if (playing) { userPaused = true; stop(); }
  else { userPaused = false; if (ended) start(); else syncAutoplay(); if (!inView) start(); }
});
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
// Play only while the manual is on screen and the tab is visible.
if ('IntersectionObserver' in window && shell) {
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncAutoplay(); }, {threshold:.35}).observe(shell);
} else { inView = true; }
document.addEventListener('visibilitychange', syncAutoplay);
renderManual();
syncAutoplay();
