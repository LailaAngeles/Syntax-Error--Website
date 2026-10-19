/* Visual enhancements only. No Firebase, chart, table or authentication code is modified. */
(() => {
  function init() {
    const sidebar = document.querySelector('.sidebar');
    const progress = document.createElement('div');
    progress.className = 'modern-scroll-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.appendChild(progress);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'modern-back-top';
    back.setAttribute('aria-label', 'Scroll to top');
    back.innerHTML = '<i class="bi bi-arrow-up" aria-hidden="true"></i>';
    back.addEventListener('click', () => window.scrollTo({top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
    document.body.appendChild(back);
    let scheduled = false;
    const update = () => {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      progress.style.width = Math.min(100, window.scrollY / scrollable * 100) + '%';
      back.classList.toggle('is-visible', window.scrollY > 300);
      sidebar?.classList.toggle('is-compact', window.scrollY > 70);
      scheduled = false;
    };
    window.addEventListener('scroll', () => {if (!scheduled) {scheduled = true; requestAnimationFrame(update)}}, {passive:true});
    window.addEventListener('resize', update, {passive:true});
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
