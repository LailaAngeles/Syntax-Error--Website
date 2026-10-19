/* SyntaxError – Firebase completionTime reader (19 levels).
   Uses the already-loaded student object; never reads or writes Firestore itself.
   Configure TOPIC_LEVELS to match the names of your actual Unity chapters.
*/
(() => {
  'use strict';
  const TOTAL_LEVELS = 19;
  // Match Firestore topic/lesson branch names to the ACTUAL game level order.
  // Do not guess a level from generic branches such as "Basic Concept".
  const LEVEL_TITLES = {
    1: 'Data Types',
    2: 'Printing Text',
    3: 'User Input',
    4: 'Comments, var & const Keywords',
    5: 'Arithmetic Operators',
    6: 'Conditionals and Loops'
  };
  const TOPIC_LEVELS = {
    'data types': 1, 'data type': 1, 'datatypes': 1,
    'printing text': 2, 'print text': 2, 'printingtext': 2,
    'console output': 2, 'printing': 2,
    'user input': 3, 'userinput': 3, 'reading user input': 3,
    'comments var and const keywords': 4,
    'comment var and const keywords': 4,
    'comments var const': 4, 'comment var const': 4,
    'comments variables and constants': 4,
    'comments and constants': 4,
    'comment debugging': 4,
    'arithmetic operators': 5, 'arithmetic': 5,
    'conditionals and loops': 6, 'loops and logical operator': 6,
    'loops and logical operators': 6,
    // When Level 7-19 topic names are confirmed, add them here.
    // Explicit level markers (e.g. level8Completed) already work without aliases.
  };
  const norm = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const topicLookup = new Map(Object.entries(TOPIC_LEVELS).map(([name,level]) => [norm(name), level]));
  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) && typeof x.toDate !== 'function';
  const escapeHTML = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function identifyLevel(name) {
    const k = norm(name);
    if (topicLookup.has(k)) return topicLookup.get(k);
    // Match explicit fields: level6Completed, completionTimeLevel6, elapsedLevel6Seconds, etc.
    const m = k.match(/(?:level|lvl)0*(1[0-9]|[1-9])(?![0-9])/);
    return m ? Number(m[1]) : null;
  }
  function identifyAttempt(name) {
    const k = norm(name);
    if (/^(?:first|1st)attemp(?:t)?$|^attemp(?:t)?0?1$/.test(k)) return 1;
    if (/^(?:second|2nd)attemp(?:t)?$|^attemp(?:t)?0?2$/.test(k)) return 2;
    if (/^(?:third|3rd)attemp(?:t)?$|^attemp(?:t)?0?3$/.test(k)) return 3;
    return null;
  }
  function seconds(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function timestamp(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') return Date.parse(value) || 0;
    return 0;
  }
  function formatSeconds(value) {
    const n = Math.round(value);
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    return h ? `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s` : `${m}m ${String(s).padStart(2,'0')}s`;
  }
  function collect(student) {
    const levels = Array.from({length:TOTAL_LEVELS}, () => ({totals:[], attempts:[[],[],[]]}));
    if (!isRecord(student)) return levels;
    const visited = new WeakSet();
    let sequence = 0;

    function walk(node, level, attempt, path, depth) {
      if (!isRecord(node) || depth > 35 || visited.has(node)) return;
      visited.add(node);
      // A numbered marker on the SAME activity also identifies unnumbered completionTime.
      const indicators = new Set(Object.keys(node).map(identifyLevel).filter(Boolean));
      const effectiveLevel = indicators.size === 1 ? [...indicators][0] : level;
      const at = timestamp(node.completedAt || node.finishedAt || node.completionTimestamp || node.updatedAt);

      for (const [key,value] of Object.entries(node)) {
        const childLevel = identifyLevel(key) || effectiveLevel;
        const childAttempt = identifyAttempt(key) || attempt;
        const keyNorm = norm(key);
        const newPath = [...path,key];
        // ONLY completionTime or explicitly numbered levelNCompletionTime is a duration.
        const completionField = keyNorm === 'completiontime' || /^(?:level|lvl)(?:1[0-9]|[1-9])completiontime$/.test(keyNorm);
        if (completionField && childLevel && childLevel >= 1 && childLevel <= TOTAL_LEVELS) {
          const duration = seconds(value);
          if (duration !== null) {
            const entry = {seconds:duration, at, path:newPath.join(' / '), order:sequence++};
            const list = childAttempt ? levels[childLevel-1].attempts[childAttempt-1] : levels[childLevel-1].totals;
            list.push(entry);
          }
        }
        if (isRecord(value)) walk(value, childLevel, childAttempt, newPath, depth+1);
      }
    }
    walk(student,null,null,[],0);
    return levels;
  }
  function latest(items) {
    if (!items.length) return null;
    // Prefer newest completedAt timestamp. When unavailable, use last encountered
    // record instead of summing console times or selecting the largest duration.
    return items.reduce((best,item) => !best || item.at > best.at || (item.at === best.at && item.order > best.order) ? item : best, null);
  }
  function render(student) {
    const mount = document.getElementById('student-level-attempts-list');
    if (!mount) return;
    const rows = collect(student).map((r,i) => ({...r, level:i+1}))
      .filter(row => row.totals.length || row.attempts.some(arr => arr.length));
    if (!rows.length) {
      mount.innerHTML = '<div class="level-no-data">No completion times found for mapped levels. Check TOPIC_LEVELS against your Firestore topic names.</div>';
      return;
    }
    mount.innerHTML = rows.map(row => {
      const attempts = row.attempts.map(latest);
      const all = [latest(row.totals),...attempts].filter(Boolean);
      const header = latest(all);
      const attemptHTML = attempts.map((record,i) => record ?
        `<div class="student-attempt-line"><span>${['1st','2nd','3rd'][i]} Attempt</span><strong>${formatSeconds(record.seconds)}</strong></div>` : '').join('');
      const total = latest(row.totals);
      const totalHTML = total ? `<div class="student-attempt-line"><span>Recorded level completion</span><strong>${formatSeconds(total.seconds)}</strong></div>` : '';
      return `<details class="student-level-row"><summary><b>Level ${row.level}${LEVEL_TITLES[row.level] ? ' — ' + escapeHTML(LEVEL_TITLES[row.level]) : ''}</b><span>${formatSeconds(header.seconds)}</span><i class="bi bi-chevron-down"></i></summary><div class="student-attempt-body">${totalHTML}${attemptHTML}</div></details>`;
    }).join('');
  }
  window.renderStudentLevelAttempts = render;
  window.SyntaxErrorLevelTimeReader = Object.freeze({collect,render,formatSeconds,LEVEL_TITLES,TOPIC_LEVELS});
})();
