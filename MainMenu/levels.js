// SyntaxError Levels portal: Cloud Firestore only. No Cloud Functions SDK.
// Do not use this file in dashboard.js or Students.js.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {getAuth,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {getFirestore,collection,query,where,getDocs,doc,setDoc,updateDoc,onSnapshot,Timestamp,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
const config={apiKey:'AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc',authDomain:'syntaxerror-data.firebaseapp.com',projectId:'syntaxerror-data',storageBucket:'syntaxerror-data.firebasestorage.app',messagingSenderId:'513961059475',appId:'1:513961059475:web:fbf6f471357465dbaad966'};
const app=initializeApp(config),auth=getAuth(app),db=getFirestore(app);
const el=id=>document.getElementById(id);
let current=null,sections=[],busy=false,teacher=null,allCodes=[],unsubscribeCodes=null;
const CODE_LIFETIME_MS=5*60*1000;
function msg(value,error=false){el('notice').textContent=value;el('notice').className=error?'error':'';}
function fail(e){console.error('[SyntaxError Levels]',e);return e?.code==='permission-denied'?'Firestore permission denied. Add the level-access security rules and teacher authorization document (see README).':e?.message||'Firebase request failed.';}
function remaining(){return current?Math.max(0,Math.ceil((current.expiresAt-Date.now())/1000)):0;}
function drawTimer(){const s=remaining();el('remaining').textContent=current?`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:'--:--';el('timebar').style.width=`${s/300*100}%`;el('copy').disabled=!s;el('revoke').disabled=!s||busy;if(!s&&current)el('current-code').textContent='EXPIRED';drawCodes();}
function drawCodes(){const list=el('code-list');list.replaceChildren();let count=0;const now=Date.now();if(!allCodes.length){const p=document.createElement('p');p.textContent='No codes generated yet.';list.append(p);}for(const c of allCodes){const exp=c.expiresAt?.toMillis?.()||0,active=c.status==='active'&&exp>now;if(active)count++;const row=document.createElement('div');row.className='access-entry';const desc=document.createElement('div');const name=document.createElement('strong');name.textContent=`Level ${c.level} · ${c.section}`;const detail=document.createElement('small');detail.textContent=`Created ${c.createdAt?.toDate?.()?.toLocaleString()||'recently'} · expires ${exp?new Date(exp).toLocaleTimeString():'?'}`;desc.append(name,detail);const badge=document.createElement('span');badge.className='status'+(active?' live':'');badge.textContent=active?'ACTIVE':c.status==='revoked'?'REVOKED':'EXPIRED';row.append(desc,badge);list.append(row);}el('active-count').textContent=String(count);}
function resetCurrent(message='Generate a code to begin'){current=null;el('current-code').textContent='— — — — — —';el('current-description').textContent=message;drawTimer();}
function idFor(level,section){return `${teacher.uid}_L${level}_${encodeURIComponent(section)}`;}
function randomPin(){const bytes=new Uint32Array(1);const max=Math.floor(2**32/900000)*900000;let n;do{crypto.getRandomValues(bytes);n=bytes[0];}while(n>=max);return String(100000+n%900000);}
async function loadSections(user){const snap=await getDocs(query(collection(db,'approvedUsers'),where('email','==',user.email)));const names=new Set();snap.forEach(d=>{const s=d.data().section;(Array.isArray(s)?s:[s]).filter(x=>typeof x==='string'&&x.trim()).forEach(x=>names.add(x.trim()));});sections=[...names];const select=el('section');select.replaceChildren();for(const name of sections){const opt=document.createElement('option');opt.value=name;opt.textContent=name;select.append(opt);}if(!sections.length){const opt=document.createElement('option');opt.value='';opt.textContent='No sections assigned';select.append(opt);msg('No assigned sections found in approvedUsers.',true);}el('generate').disabled=!sections.length;}
function watchCodes(){if(unsubscribeCodes)unsubscribeCodes();unsubscribeCodes=onSnapshot(query(collection(db,'levelAccessCodes'),where('teacherUid','==',teacher.uid)),snap=>{allCodes=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));drawCodes();},e=>msg(fail(e),true));}
async function withBusy(action){if(busy||!teacher)return;busy=true;el('generate').disabled=true;el('revoke').disabled=true;try{await action();}catch(e){msg(fail(e),true);}finally{busy=false;el('generate').disabled=!sections.length;drawTimer();}}
el('generate').addEventListener('click',()=>withBusy(async()=>{
 const level=Number(el('level').value),section=el('section').value;if(!Number.isInteger(level)||level<2||level>19||!sections.includes(section))throw Error('Select a valid level and assigned section.');
 const pin=randomPin(),now=Date.now(),expiresAt=Timestamp.fromMillis(now+CODE_LIFETIME_MS);const id=idFor(level,section);
 // One document per teacher / level / section; new code replaces previous code.
 await setDoc(doc(db,'levelAccessCodes',id),{teacherUid:teacher.uid,level,section,code:pin,status:'active',createdAt:serverTimestamp(),expiresAt});
 current={id,code:pin,expiresAt:expiresAt.toMillis()};el('current-code').textContent=pin;el('current-description').textContent=`Level ${level} · ${section}`;drawTimer();msg('PIN saved to Cloud Firestore. Share it before the five-minute deadline.');
}));
el('copy').addEventListener('click',async()=>{if(!remaining())return;try{await navigator.clipboard.writeText(current.code);msg('PIN copied.');}catch(e){msg('Clipboard unavailable; select and copy the displayed PIN.',true);}});
el('revoke').addEventListener('click',()=>withBusy(async()=>{if(!current||!remaining())return;await updateDoc(doc(db,'levelAccessCodes',current.id),{status:'revoked'});resetCurrent('Code revoked');msg('PIN revoked in Firestore.');}));
el('refresh').addEventListener('click',()=>{drawCodes();msg('Activity is synchronized live with Firestore.');});
el('logout').addEventListener('click',async e=>{e.preventDefault();if(unsubscribeCodes)unsubscribeCodes();await signOut(auth);location.href='../index.html';});
for(let n=2;n<=19;n++){const opt=document.createElement('option');opt.value=n;opt.textContent=`Level ${n} — Unlock`;el('level').append(opt);}
const saved=localStorage.getItem('dashboard-theme')||'light';document.documentElement.dataset.theme=saved;
function icon(){el('theme-toggle').innerHTML=document.documentElement.dataset.theme==='dark'?'<i class="bi bi-sun-fill"></i>':'<i class="bi bi-moon-stars-fill"></i>';}
icon();el('theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('dashboard-theme',theme);icon();});
onAuthStateChanged(auth,async user=>{if(unsubscribeCodes){unsubscribeCodes();unsubscribeCodes=null;}teacher=user;resetCurrent();allCodes=[];drawCodes();if(!user){location.href='../index.html';return;}try{await loadSections(user);watchCodes();}catch(e){msg(fail(e),true);}});
setInterval(drawTimer,1000);
