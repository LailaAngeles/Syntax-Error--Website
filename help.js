// User manual page: guide switch (teacher / Super Admin), search, contents with scroll highlight,
// and animated illustrations that replay when scrolled into view.
(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.hm-sec')];
  const tocList = document.getElementById('hm-toc-list');
  const search = document.getElementById('hm-search');
  const result = document.getElementById('hm-search-result');
  const empty = document.getElementById('hm-empty');
  const switches = [...document.querySelectorAll('.hm-switch [data-audience]')];
  let audience = 'teacher';

  // Original text of each section, so search highlights can be removed again.
  const original = new Map(sections.map(s => [s, s.innerHTML]));

  function buildToc() {
    tocList.replaceChildren();
    sections.filter(s => !s.hidden).forEach(s => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + s.id;
      a.textContent = s.querySelector('h2').textContent;
      li.append(a);
      tocList.append(li);
    });
    highlightToc();
  }

  function setAudience(name, { scroll = false } = {}) {
    audience = name;
    switches.forEach(b => {
      const on = b.dataset.audience === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    applyFilter();
    if (scroll) window.scrollTo({ top: document.querySelector('.hm-layout').offsetTop - 70, behavior: 'smooth' });
  }

  function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Highlights matches in text nodes only (never inside tags).
  function highlight(section, term) {
    const re = new RegExp(escapeRegExp(term), 'gi');
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('.hm-scene, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const frag = document.createDocumentFragment();
      let last = 0;
      node.nodeValue.replace(re, (match, offset) => {
        frag.append(node.nodeValue.slice(last, offset), Object.assign(document.createElement('mark'), { textContent: match }));
        last = offset + match.length;
      });
      frag.append(node.nodeValue.slice(last));
      node.replaceWith(frag);
    });
  }

  function applyFilter() {
    const term = search.value.trim();
    let shown = 0;
    sections.forEach(s => {
      s.innerHTML = original.get(s);
      const inGuide = s.dataset.audience === audience;
      const matches = !term || s.textContent.toLowerCase().includes(term.toLowerCase());
      s.hidden = !(inGuide && matches);
      if (!s.hidden) { shown++; if (term) highlight(s, term); }
    });
    // Replaced markup needs its illustrations wired up again.
    setupScenes();
    empty.hidden = shown > 0;
    result.textContent = term ? `${shown} section${shown === 1 ? '' : 's'} match "${term}"` : '';
    // Open matching FAQ answers so the highlighted words are visible.
    if (term) document.querySelectorAll('.hm-faq details').forEach(d => { if (d.querySelector('mark')) d.open = true; });
    buildToc();
  }

  // Contents highlight follows the section in view.
  function highlightToc() {
    const visible = sections.filter(s => !s.hidden);
    let current = visible[0];
    for (const s of visible) if (s.getBoundingClientRect().top < 140) current = s;
    tocList.querySelectorAll('a').forEach(a => a.classList.toggle('active', current && a.getAttribute('href') === '#' + current.id));
  }
  window.addEventListener('scroll', highlightToc, { passive: true });

  // Illustrations play when they come into view; "Replay" restarts them.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sceneObserver = null;
  function restart(figure) {
    figure.classList.remove('current');
    void figure.offsetWidth;
    figure.classList.add('current');
  }
  function setupScenes() {
    sceneObserver?.disconnect();
    const figures = [...document.querySelectorAll('.hm-scene')];
    figures.forEach(f => {
      f.querySelector('.hm-replay')?.addEventListener('click', () => restart(f));
      if (reduced) f.classList.add('current');
    });
    if (reduced || !('IntersectionObserver' in window)) { figures.forEach(f => f.classList.add('current')); return; }
    sceneObserver = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) restart(e.target); else e.target.classList.remove('current');
    }), { threshold: .45 });
    figures.forEach(f => sceneObserver.observe(f));
  }

  switches.forEach(b => b.addEventListener('click', () => setAudience(b.dataset.audience, { scroll: window.scrollY > 300 })));
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(applyFilter, 160); });
  document.getElementById('hm-print')?.addEventListener('click', () => window.print());

  // Links like help.html#admin-students open the right guide and section.
  function fromHash() {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target?.dataset.audience) {
      setAudience(target.dataset.audience);
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    } else setAudience('teacher');
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
