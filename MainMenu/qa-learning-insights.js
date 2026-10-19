/* QA analytics: purely observational; no Firestore writes or new listeners.
   Called from Students.js on every real-time student snapshot. */
(() => {
  'use strict';
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function attemptNumber(key) {
    const k = norm(key);
    return ({firstattemp:1,firstattempt:1,secondattemp:2,secondattempt:2,thirdattemp:3,thirdattempt:3})[k] || 0;
  }
  const validNumber = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  const subjectRoot = student => student?.['Subject Content'] || student?.subjectContent || {};
  function collect(student) {
    const subject = subjectRoot(student);
    const entries = new Map();
    let completedWithTime = 0, completedWithoutTime = 0, timedActivities = 0;
    let datedCount = 0, undatedCount = 0;
    const seen = new WeakSet();
    function walk(node, path, topic, att, depth) {
      if (!node || typeof node !== 'object' || depth > 24 || seen.has(node)) return;
      if (Array.isArray(node)) { node.forEach((x,i)=>walk(x,[...path,String(i)],topic,att,depth+1)); return; }
      if (node.toDate && typeof node.toDate === 'function') return;
      seen.add(node);
      const hasWrongs = Object.prototype.hasOwnProperty.call(node,'wrongAttempts') && validNumber(node.wrongAttempts);
      const hasCompletion = validNumber(node.completionTime);
      const markedComplete = node.completed === true;
      const hasTimestamp = !!(node.completedAt || node.lastWrongAttemptAt);
      if (hasWrongs || hasCompletion || markedComplete) {
        const activity = path.slice(path.findIndex(p => attemptNumber(p)) + 1).join(' / ') || '(topic summary)';
        const key = `${topic}\u0001${activity}`;
        if (!entries.has(key)) entries.set(key,{topic, activity, attempts:{}});
        const record=entries.get(key);
        const current=record.attempts[att || 0] || {wrong:null,time:null,complete:false,dated:false};
        if (hasWrongs) current.wrong=Number(node.wrongAttempts);
        if (hasCompletion) current.time=Number(node.completionTime);
        current.complete ||= markedComplete;
        current.dated ||= hasTimestamp;
        record.attempts[att || 0]=current;
        if (markedComplete && hasCompletion) completedWithTime++;
        if (markedComplete && !hasCompletion) completedWithoutTime++;
        if (hasCompletion) timedActivities++;
        if (hasTimestamp) datedCount++; else undatedCount++;
      }
      Object.entries(node).forEach(([k,v]) => {
        if (!v || typeof v !== 'object' || (v.toDate && typeof v.toDate === 'function')) return;
        const a=attemptNumber(k);
        walk(v,[...path,k],topic,a||att,depth+1);
      });
    }
    for (const [topic, value] of Object.entries(subject)) walk(value,[topic],topic,0,0);
    const records=[...entries.values()];
    const latest=[]; let matched=0,improved=0,worsened=0,unchanged=0,comparable=[];
    for(const r of records){
      const series=[1,2,3].filter(n=>r.attempts[n]?.wrong !== null && r.attempts[n]?.wrong !== undefined);
      if(series.length){const last=r.attempts[series[series.length-1]];latest.push({...r,wrong:last.wrong,attempt:series[series.length-1]});}
      if(series.length>=2){
        const first=r.attempts[series[0]].wrong, last=r.attempts[series[series.length-1]].wrong;
        matched++; if(last<first)improved++;else if(last>first)worsened++;else unchanged++;
        comparable.push({topic:r.topic,activity:r.activity,first,last,attempts:series.length});
      }
    }
    const totalLatest=latest.reduce((sum,x)=>sum+x.wrong,0);
    const ranked=[...latest].sort((a,b)=>b.wrong-a.wrong);
    const topics=new Set(records.map(x=>x.topic));
    return {records:records.length,topics:topics.size,latest,ranked,totalLatest,matched,improved,worsened,unchanged,comparable,completedWithTime,completedWithoutTime,timedActivities,datedCount,undatedCount};
  }
  const create=(tag,cls,content)=>{
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(content!==undefined) el.textContent=String(content);
    return el;
  };
  function tile(icon,label,value,sublabel){
    const item=create('div','qa-kpi');
    item.append(create('span','qa-kpi-icon',icon),create('span','qa-kpi-label',label),create('strong','qa-kpi-value',value));
    if(sublabel) item.append(create('span','qa-kpi-sub',sublabel));
    return item;
  }
  function bar(label,count,total,type){
    const line=create('div','qa-viz-line');
    const head=create('div','qa-viz-line-head');
    head.append(create('span','',label),create('strong','',String(count)));
    const track=create('div','qa-viz-track');
    const fill=create('div','qa-viz-fill '+type);
    fill.style.width=`${total ? 100*count/total : 0}%`;
    track.append(fill);line.append(head,track);
    return line;
  }
  function render(student){
    const host=document.getElementById('qa-learning-insights');
    if(!host)return;
    const d=collect(student);
    host.replaceChildren();
    const heading=create('div','qa-clear-heading');
    const headingText=create('div','');
    headingText.append(create('h3','','Where does this student struggle?'),create('p','','C# topics ranked by incorrect code submissions in the latest recorded attempt for each activity.'));
    heading.append(headingText,create('span','qa-live-tag','● Live Firebase data'));
    host.append(heading);
    const rankedTopics=new Map();
    for(const activity of d.latest){rankedTopics.set(activity.topic,(rankedTopics.get(activity.topic)||0)+activity.wrong);}
    const topics=[...rankedTopics].sort((a,b)=>b[1]-a[1]);
    const summary=create('div','qa-clear-stats');
    summary.append(
      tile('▦','Recorded C# topics',topics.length,''),
      tile('!','Incorrect submissions',d.latest.length?d.totalLatest:'—','Latest attempt for each recorded coding task'),
      tile('↗','Topic with most errors',topics.length?String(topics[0][0]).replace(/[_-]/g,' '):'—','Highest recorded count')
    );
    host.append(summary);
    const content=create('div','qa-clear-grid');
    const ranking=create('section','qa-clear-panel');
    ranking.append(create('h4','','Topics with the most incorrect submissions'),create('p','qa-short-info','The most errors appear first. Counts come from the latest recorded attempt of each task.'));
    if(topics.length){
      const max=topics[0][1] || 1;
      topics.forEach(([name,count],i)=>{
        const item=create('div','qa-topic-row');
        const head=create('div','qa-topic-head');
        head.append(create('strong','',`${i+1}. ${String(name).replace(/[_-]/g,' ')}`),create('span','',`${count} incorrect ${count===1?'submission':'submissions'}`));
        const track=create('div','qa-topic-track');const fill=create('div','qa-topic-fill');
        fill.style.width=`${Math.max(0,Math.min(100,100*count/max))}%`;track.append(fill);item.append(head,track);ranking.append(item);
      });
    }else ranking.append(create('p','qa-no-records','No recorded incorrect-submission data yet.'));
    content.append(ranking);

    const breakdown=create('section','qa-clear-panel qa-attempt-panel');
    breakdown.append(create('h4','','Which C# topic has the most errors?'));
    breakdown.append(create('p','qa-short-info','Each donut slice represents a topic’s share of recorded incorrect submissions.'));
    if(topics.length && d.totalLatest>0){
      const donutWrap=create('div','qa-donut-layout');
      const donut=create('div','qa-donut');
      const palette=['#ff735c','#3288f5','#f5b940','#13bfa0','#a384ea','#eb72a4','#53c3d8','#7e9bbf'];
      let position=0;
      const stops=[];
      topics.forEach(([,count],index)=>{
        const next=position+count/d.totalLatest*100;
        stops.push(`${palette[index%palette.length]} ${position.toFixed(4)}% ${next.toFixed(4)}%`);
        position=next;
      });
      donut.style.background=`conic-gradient(${stops.join(',')})`;
      donut.setAttribute('role','img');
      donut.setAttribute('aria-label',`${d.totalLatest} incorrect submissions across ${topics.length} recorded C# topics`);
      const hole=create('div','qa-donut-hole');
      hole.append(create('strong','qa-donut-number',d.totalLatest),create('span','qa-donut-sub','incorrect submissions'));
      donut.append(hole);
      const legend=create('div','qa-donut-legend');
      topics.forEach(([name,count],index)=>{
        const row=create('div','qa-donut-legend-row');
        const left=create('span','qa-donut-legend-label');
        const dot=create('span','qa-donut-dot');dot.style.background=palette[index%palette.length];
        left.append(dot,create('span','',String(name).replace(/[_-]/g,' ')));
        row.append(left,create('strong','',`${count} (${Math.round(count/d.totalLatest*100)}%)`));
        legend.append(row);
      });
      donutWrap.append(donut,legend);breakdown.append(donutWrap);
      const highest=create('div','qa-topic-summary');
      highest.append(create('span','','Most incorrect submissions'),create('strong','',String(topics[0][0]).replace(/[_-]/g,' ')));
      breakdown.append(highest);
    }else{
      breakdown.append(create('p','qa-no-records',topics.length?'No incorrect submissions recorded in the latest attempts.':'No topic records available yet.'));
    }
    const detail=create('details','qa-data-source');
    detail.append(create('summary','','How is this calculated?'));
    const body=create('div','qa-data-source-body');
    body.append(create('p','','Firestore: sections / [section] / classList / [student] / Subject Content / [topic] / [attempt] / [task] / wrongAttempts'));
    body.append(create('p','','For each task, only the highest-numbered recorded attempt (1st–3rd) is used. The current incorrect submissions from those tasks are then added within each topic. The donut shows each topic’s share of those submissions, not a percentage of mastery.'));
    detail.append(body);breakdown.append(detail);
    content.append(breakdown);host.append(content);
    const foot=create('p','qa-data-note','Based on saved Firebase submissions. Higher counts indicate more recorded errors, not proof of lower understanding. Unrecorded topics are excluded.');host.append(foot);
  }
  window.renderQALearningInsights=render;
  window.__qaCollectStudentEvidence=collect; // Exposed for standalone automated validation.
})();
