import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
// Fixed: Added getAuth to the imports
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ----------------------------
// CONFIG & INITIALIZATION
// ----------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// Fixed: Initialized the auth instance
const auth = getAuth(app); 

let allStudents = [];
let difficultyChart;

const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if(loader) loader.style.display = show ? "flex" : "none";
};

window.showLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "flex";
    }
};

// 2. Hide the Popup (Stay button)
window.closeLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "none";
    }
};

// 3. Execute Logout
window.logoutUser = async function() {
    toggleLoading(true);
    try {
        await signOut(auth);
         window.location.href = '../Components/LogIn.html';
    } catch (error) {
        console.error("Logout Error:", error);
        alert("Sign out failed. Please try again.");
    } finally {
        toggleLoading(false);
    }
};

// ----------------------------
// 1. DATA FETCHING
// ----------------------------
// Realtime subscriptions: only active classes remain subscribed.
let stopSectionList = null;
const activeClassListeners = new Map();
const latestClasses = new Map();
let selectedStudentKey = null;
function renderLiveClasses() {
    allStudents = [...latestClasses.values()].flat();
    renderTable(document.getElementById('section-select')?.value || '');
    if (selectedStudentKey && document.getElementById('analysis-section')?.style.display !== 'none') {
        const student=allStudents.find(s=>`${s.parentDocId}/${s.firebaseId}` === selectedStudentKey);
        if(student) window.viewAnalysis(student.firebaseId,student.parentDocId);
        else closeStudentSummary();
    }
}
function fetchAllDatabaseContent() {
    toggleLoading(true);
    if(stopSectionList) stopSectionList();
    stopSectionList=onSnapshot(collection(db,'sections'), snapshot=>{
        const wanted=new Map();
        const select=document.getElementById('section-select');
        const current=select?.value || '';
        if(select)select.innerHTML='<option value="">-- All Sections --</option>';
        snapshot.forEach(d=>{
            const name=d.data().name || d.id;
            wanted.set(d.id,name);
            if(select){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option)}
        });
        if(select && [...select.options].some(o=>o.value===current))select.value=current;
        for(const [id,stop] of activeClassListeners){
            if(!wanted.has(id)){stop();activeClassListeners.delete(id);latestClasses.delete(id)}
        }
        for(const [id,name] of wanted){
            if(!activeClassListeners.has(id)){
                const unsub=onSnapshot(collection(db,'sections',id,'classList'), snap=>{
                    latestClasses.set(id,snap.docs.map(d=>({...d.data(),sectionName:wanted.get(id)||name,firebaseId:d.id,parentDocId:id})));
                    renderLiveClasses();
                },err=>{console.error('Student listener error',err);toggleLoading(false)});
                activeClassListeners.set(id,unsub);
            } else {
                latestClasses.get(id)?.forEach(s=>{s.sectionName=name});
            }
        }
        renderLiveClasses();toggleLoading(false);
    },err=>{console.error('Sections listener error',err);toggleLoading(false)});
}
window.addEventListener('pagehide',()=>{stopSectionList?.();activeClassListeners.forEach(stop=>stop());activeClassListeners.clear()});
// ----------------------------
// 2. RENDERING LOGIC (Updated with Empty State UI)
// ----------------------------
function renderTable(filterSection) {
    const tableBody = document.getElementById("students-table");
    const searchTerm = document.getElementById("search-student")?.value.toLowerCase() || "";

    if (!tableBody) return;

    // 1. Filter the data
    let filtered = allStudents.filter(s => {
        const matchesSection = !filterSection || s.sectionName === filterSection;
        const matchesSearch = !searchTerm || 
                              (s.name && s.name.toLowerCase().includes(searchTerm)) || 
                              (s.id && String(s.id).replace(/^0+/, '').includes(searchTerm.replace(/^0+/, ''))) ;
        return matchesSection && matchesSearch;
    });

    // 2. Sort alphabetically by name
    filtered.sort((a, b) => {
        const nameA = (a.name || "").toLowerCase();
        const nameB = (b.name || "").toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // Update Totals
    document.getElementById("card-total-students").textContent = filtered.length;
    let avg = filtered.length > 0 ? Math.round(filtered.reduce((acc, s) => acc + levelProgress(s).percent, 0) / filtered.length) : 0;
    document.getElementById("average-score").textContent = avg + "%";

    // 3. UI logic: Handle Empty State vs Table rows
    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div style="font-size: 2rem; margin-bottom: 10px;"><i class="bi bi-inbox"></i></div>
                    <h4>No Students Found</h4>
                    <p>Try adjusting your search or section filter.</p>
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = filtered.map(s => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px; font-weight: 600;">${safeText(s.id || s.firebaseId || '---')}</td>
                <td style="padding: 15px;">${safeText(s.name || 'Unknown')}</td>
                <td style="padding: 15px;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 20px;">${safeText(s.sectionName)}</span></td>
                <td style="padding: 15px;">
                    <div style="width: 100px; background: #e2e8f0; height: 6px; border-radius: 10px;">
                        <div style="width: ${levelProgress(s).percent}%; background: #3b82f6; height: 100%; border-radius: 10px;"></div>
                    </div>
                    <small style="color: #64748b;">${levelProgress(s).percent}%</small>
                </td>
                <td style="padding: 15px;">
                    <button data-student-id="${safeText(s.firebaseId)}" data-section-id="${safeText(s.parentDocId)}" class="open-student-summary" style="background: #3b82f6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer;">
                        Details
                    </button>
                </td>
            </tr>
        `).join("");
    }
}
// ----------------------------
// 3. STUDENT-SPECIFIC SUMMARY (Firestore-based)
// ----------------------------
const safeText = value => String(value ?? "--").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numberOrNull = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const topicColor = value => value >= 7 ? '#ef4444' : value >= 4 ? '#f59e0b' : '#10b981';
const attemptNumber = name => ({firstattempt:1,firstattemp:1,secondattempt:2,secondattemp:2,thirdattempt:3,thirdattemp:3})[String(name).toLowerCase().replace(/[^a-z0-9]/g,'')]||0;
function studentTopics(student) {
    const content=student['Subject Content'] || student.subjectContent || {};
    if(!content || typeof content !== 'object') return [];
    const results=[];
    for(const [name,root] of Object.entries(content)) {
        const activities=new Map();
        function walk(node,path=[],attempt=0,depth=0){
            if(!node||typeof node!=='object'||depth>24||typeof node.toDate==='function')return;
            if(Array.isArray(node)){node.forEach((v,i)=>walk(v,[...path,String(i)],attempt,depth+1));return}
            const hasWrong=Object.prototype.hasOwnProperty.call(node,'wrongAttempts');
            const hasTime=Object.prototype.hasOwnProperty.call(node,'completionTime');
            if(hasWrong||hasTime){
                const key=path.filter(x=>!attemptNumber(x)).join('/')||'Topic summary';
                const a=activities.get(key)||{attempt:-1,wrong:null,time:null};
                const n=numberOrNull(node.wrongAttempts),time=numberOrNull(node.completionTime);
                if(attempt>a.attempt){a.attempt=attempt;a.wrong=null;a.time=null}
                if(attempt===a.attempt){if(hasWrong&&n!==null&&n>=0)a.wrong=n;if(hasTime&&time!==null&&time>=0)a.time=time}
                activities.set(key,a);
            }
            for(const [k,v] of Object.entries(node))if(v&&typeof v==='object')walk(v,[...path,k],attemptNumber(k)||attempt,depth+1);
        }
        walk(root);
        const values=[...activities.values()];
        const wrongEntries=values.filter(v=>v.wrong!==null);
        const timeEntries=values.filter(v=>v.time!==null);
        if(!wrongEntries.length&&!timeEntries.length)continue;
        const wrongs=wrongEntries.reduce((total,v)=>total+v.wrong,0);
        results.push({name:name.replace(/_/g,' '),wrongs:wrongEntries.length?wrongs:null,score:Math.min(10,wrongs),time:timeEntries.reduce((total,v)=>total+v.time,0),timedTasks:timeEntries.length,tasks:activities.size});
    }
    return results.sort((a,b)=>(b.wrongs??-1)-(a.wrongs??-1)||a.name.localeCompare(b.name));
}
function levelProgress(student){
    const completed=new Set(); const seen=new WeakSet();
    function walk(node,context=null,depth=0){
        if(!node||typeof node!=='object'||depth>25||seen.has(node)||typeof node.toDate==='function')return;
        seen.add(node);
        for(const [k,v] of Object.entries(node)){
            const n=k.toLowerCase().replace(/[^a-z0-9]/g,'');
            const m=n.match(/^level(\d{1,2})(?:is)?(?:completed|complete|finished)$/)||n.match(/^(?:completed|complete|finished)level(\d{1,2})$/);
            if(m&&(v===true||v===1||v==='true')){const level=Number(m[1]);if(level>=1&&level<=19)completed.add(level)}
            const cm=n.match(/^level(\d{1,2})$/);const next=cm?Number(cm[1]):context;
            if(next&&/^(completed|iscompleted|finished)$/.test(n)&&(v===true||v===1||v==='true'))completed.add(next);
            if(v&&typeof v==='object')walk(v,next,depth+1);
        }
    }
    walk(student);return {completed:completed.size,percent:Math.round(completed.size/19*100)};
}
function duration(seconds){if(!Number.isFinite(seconds))return '--';const n=Math.round(seconds);return `${Math.floor(n/3600)?Math.floor(n/3600)+'h ':''}${Math.floor(n%3600/60)}m ${String(n%60).padStart(2,'0')}s`}
function renderTopicSummary(topics) {
    const list = document.getElementById('summary-topic-list');
    list.replaceChildren();
    if (!topics.length) { list.textContent='No topic difficulty records available yet.'; return; }
    topics.forEach((topic, index) => {
        const item = document.createElement('div'); item.className='summary-topic';
        const heading=document.createElement('div'); heading.className='summary-topic-head';
        const name=document.createElement('span'); name.textContent=`${index+1}. ${topic.name}`;
        const score=document.createElement('strong'); score.textContent=`${topic.score}/10`; score.style.color=topicColor(topic.score);
        heading.append(name,score);
        const track=document.createElement('div'); track.className='summary-track';
        const fill=document.createElement('div'); fill.style.width=`${topic.score*10}%`; fill.style.backgroundColor=topicColor(topic.score);
        track.append(fill);
        const note=document.createElement('small'); note.textContent=topic.wrongs===null ? 'No error count recorded' : `${topic.wrongs} recorded wrong attempts`;
        item.append(heading,track,note); list.append(item);
    });
}
window.viewAnalysis = function(firebaseId,parentDocId=null) {
    const student = allStudents.find(s=>String(s.firebaseId)===String(firebaseId) && (!parentDocId || s.parentDocId===parentDocId));
    if (!student) return;
    selectedStudentKey=`${student.parentDocId}/${student.firebaseId}`;
    const panel=document.getElementById('analysis-section');
    panel.style.display='flex';
    document.body.classList.add('summary-modal-open');
    document.getElementById('summary-description').textContent=`${student.name || 'Student'} · ${student.sectionName || 'No Section'}`;
    const profile=document.getElementById('student-details-content');
    const levelInfo=levelProgress(student);
    const fields=[['Full Name',student.name],['Student Number',student.id || student.firebaseId],['Section',student.sectionName],['Completed Levels',`${levelInfo.completed} of 19`]];
    profile.innerHTML=fields.map(([label,value])=>`<div class="summary-profile-field"><span>${label}</span><strong>${safeText(value)}</strong></div>`).join('');
    const progress=levelInfo.percent;
    const progressValue=progress===null?null:Math.max(0,Math.min(100,progress));
    document.getElementById('summary-progress').textContent=progressValue===null?'--':`${Math.round(progressValue)}%`;
    document.getElementById('summary-progress-fill').style.width=`${progressValue??0}%`;
    const topics=studentTopics(student);
    renderTopicSummary(topics);
    const highest=topics.length?Math.max(...topics.map(t=>t.score)):null;
    const totals=topics.filter(t=>t.wrongs!==null);
    const wrongs=totals.length?totals.reduce((sum,t)=>sum+t.wrongs,0):null;
    document.getElementById('summary-difficulty').textContent=highest===null?'--':`${highest}/10`;
    document.getElementById('summary-wrongs').textContent=wrongs===null?'--':String(wrongs);
    const totalTime=topics.reduce((sum,t)=>sum+(t.time||0),0);
    const timeEl=document.getElementById('summary-time');if(timeEl)timeEl.textContent=topics.some(t=>t.timedTasks)?duration(totalTime):'--';
    const coverage=document.getElementById('summary-coverage');if(coverage)coverage.textContent=topics.length+' topics with recorded results';
    const insight=document.getElementById('summary-insight-content');
    if (!topics.length) insight.textContent='No attempt records available yet. More data will appear after the student completes learning activities.';
    else {
        const hardest=topics[0];
        const progressPhrase=`${levelInfo.completed} of 19 levels marked completed.`;
        insight.innerHTML=`<p><strong>Highest recorded difficulty:</strong> ${safeText(hardest.name)} (${hardest.wrongs??'--'} latest incorrect submissions).</p><p>${progressPhrase}</p><p>Counts use the latest numbered attempt for each task. Time uses completionTime only; missing records are excluded.</p>`;
    }
    renderChart(topics);
    panel.focus({preventScroll:true});
};
function renderChart(topics) {
    const canvas=document.getElementById('difficultyChart');
    if (!canvas) return;
    if (difficultyChart) { difficultyChart.destroy(); difficultyChart=null; }
    document.getElementById('summary-chart-empty').hidden=topics.length>0;
    canvas.hidden=topics.length===0;
    if (!topics.length || typeof Chart==='undefined') return;
    difficultyChart=new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{labels:topics.map(t=>t.name),datasets:[{label:'Difficulty Score',data:topics.map(t=>t.score),backgroundColor:topics.map(t=>topicColor(t.score)),borderRadius:5}]},
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:(ctx)=>topics[ctx.dataIndex].wrongs===null?'No error count recorded':`${topics[ctx.dataIndex].wrongs} recorded wrong attempts`}}},scales:{x:{beginAtZero:true,max:10,ticks:{stepSize:2}},y:{ticks:{autoSkip:false}}}}
    });
}
function closeStudentSummary() {
    const panel = document.getElementById('analysis-section');
    if (!panel || panel.style.display === 'none') return;
    panel.style.display = 'none';
    document.body.classList.remove('summary-modal-open');
    selectedStudentKey=null;
}
document.getElementById('close-analysis')?.addEventListener('click', closeStudentSummary);
document.getElementById('analysis-section')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeStudentSummary();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeStudentSummary();
});

// ----------------------------
// 4. INITIALIZE & EVENTS
// ----------------------------
fetchAllDatabaseContent();

document.getElementById("section-select")?.addEventListener("change", (e) => renderTable(e.target.value));
document.getElementById("search-student")?.addEventListener("input", () => {
    const sel = document.getElementById("section-select").value;
    renderTable(sel);
});

// Fixed: Added event listener to trigger the logout popup
document.getElementById("logout-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.showLogoutPopup();
});
// Delegated click handler for student summary buttons.
document.getElementById('students-table')?.addEventListener('click', (event) => {
    const button = event.target.closest('.open-student-summary');
    if (button) window.viewAnalysis(button.dataset.studentId, button.dataset.sectionId);
});
