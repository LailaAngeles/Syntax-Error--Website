import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, writeBatch, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

// Original Firebase project, authentication verification, and archive paths preserved.
const firebaseConfig = {
  apiKey: 'AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc',
  authDomain: 'syntaxerror-data.firebaseapp.com',
  projectId: 'syntaxerror-data',
  storageBucket: 'syntaxerror-data.firebasestorage.app',
  messagingSenderId: '513961059475',
  appId: '1:513961059475:web:fbf6f471357465dbaad966'
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const VERIFIED_KEY = 'syntaxerror_verified_uid';
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;
const $ = id => document.getElementById(id);
let allArchived = [];
let selected = new Set();
let unsubscribeArchives = null;
let deleteTargets = [];
let busy = false;
let cleanupRunning = false;

const normalizeId = value => String(value ?? '').replace(/^0+(?=\d)/, '').toLowerCase();
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeMs = val => {
  if (!val) return null;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val.seconds === 'number') return val.seconds * 1000;
  if (val instanceof Date) return val.getTime();
  const n = new Date(val).getTime();
  return Number.isFinite(n) ? n : null;
};
function archiveExpires(row) {
  const archived = timeMs(row.archivedAt);
  return archived === null ? timeMs(row.expiresAt) : archived + DAYS_7;
}
function formatDate(val) {
  const ms = timeMs(val);
  return ms === null ? 'Not recorded' : new Date(ms).toLocaleString(undefined, {dateStyle:'medium',timeStyle:'short'});
}
function timeRemaining(row) {
  const expiry = archiveExpires(row);
  if (expiry === null) return {label:'Archive date missing', cls:'unknown'};
  const diff = expiry - Date.now();
  if (diff <= 0) return {label:'Expired • pending deletion', cls:'expired'};
  const hours = Math.ceil(diff / 3600000);
  if (hours <= 24) return {label:`${hours}h left`, cls:'soon'};
  return {label:`${Math.ceil(diff / 86400000)} days left`, cls:'safe'};
}
function matches(row, term) {
  if (!term) return true;
  const q = term.trim().toLowerCase();
  return String(row.name ?? '').toLowerCase().includes(q) ||
    String(row.section ?? '').toLowerCase().includes(q) ||
    String(row.id ?? row.docId ?? '').toLowerCase().includes(q) ||
    normalizeId(row.id ?? row.docId).includes(normalizeId(q));
}
const getVisible = () => allArchived.filter(r => matches(r, $('search-archive')?.value ?? ''));
function toggleLoading(show) { if ($('loading-overlay')) $('loading-overlay').style.display = show ? 'flex' : 'none'; }
function renderTable() {
  selected = new Set([...selected].filter(id => allArchived.some(r => r.docId === id)));
  const rows = getVisible();
  $('archive-total').textContent = String(allArchived.length);
  $('archive-expiring').textContent = String(allArchived.filter(r => {const t=archiveExpires(r);return t !== null && t > Date.now() && t - Date.now() <= 86400000;}).length);
  $('archive-selected').textContent = String(selected.size);
  $('archive-result-count').textContent = `${rows.length} record${rows.length===1?'':'s'} shown`;
  $('restore-selected-btn').disabled = busy || selected.size === 0;
  $('delete-selected-btn').disabled = busy || selected.size === 0;
  $('delete-all-btn').disabled = busy || allArchived.length === 0;
  $('archive-select-all').disabled = busy || rows.length === 0;
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.docId));
  $('archive-select-all').checked = allChecked;
  $('archive-select-all').indeterminate = !allChecked && rows.some(r => selected.has(r.docId));
  $('archived-students-table').innerHTML = rows.length ? rows.map(r => {
    const expiry = timeRemaining(r);
    const id = escapeHTML(r.docId);
    return `<tr class="${selected.has(r.docId)?'selected-row':''}">
      <td class="archive-check"><input type="checkbox" class="archive-item-check" data-id="${id}" aria-label="Select ${escapeHTML(r.name||'student')}" ${selected.has(r.docId)?'checked':''} ${busy?'disabled':''}></td>
      <td><div class="archive-student-name">${escapeHTML(r.name||'Unnamed student')}</div><small class="archive-student-id">ID: ${escapeHTML(r.id||r.docId)}</small></td>
      <td>${escapeHTML(r.section||'Unknown section')}</td>
      <td>${escapeHTML(formatDate(r.archivedAt))}</td>
      <td><span class="archive-status ${expiry.cls}">${escapeHTML(expiry.label)}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="archive-empty"><i class="bi bi-inbox"></i><p>No matching archived students.</p></td></tr>';
}
function showDelete(ids) {
  if (busy) return;
  const unique = [...new Set(ids)].filter(id => allArchived.some(r => r.docId === id));
  if (!unique.length) return;
  deleteTargets = unique;
  $('archive-confirm-title').textContent = unique.length === 1 ? 'Delete archived student?' : `Delete ${unique.length} archived students?`;
  $('archive-confirm-message').textContent = `Permanently delete ${unique.length} selected archived record${unique.length===1?'':'s'}? This cannot be undone.`;
  $('delete-all-modal').style.display = 'flex';
}
window.closeDeleteAllModal = () => { if (!busy) {$('delete-all-modal').style.display='none'; deleteTargets=[];} };

async function deleteArchived(ids) {
  const distinct = [...new Set(ids)];
  for (let i=0; i<distinct.length; i+=450) {
    const batch=writeBatch(db);
    distinct.slice(i,i+450).forEach(id => batch.delete(doc(db,'archivedStudents',id)));
    await batch.commit();
  }
}
async function handleDelete() {
  if (busy || !deleteTargets.length) return;
  busy=true;
  const chosen=[...deleteTargets];
  $('confirm-delete-all-btn').disabled=true;
  $('confirm-delete-all-btn').textContent='Deleting...';
  toggleLoading(true);
  try {
    await deleteArchived(chosen);
    chosen.forEach(id => selected.delete(id));
    $('delete-all-modal').style.display='none';
    deleteTargets=[];
  } catch(e) { console.error('Archive deletion failed',e); alert('Unable to delete all requested students. Please check permissions and try again.'); }
  finally {busy=false;toggleLoading(false);$('confirm-delete-all-btn').disabled=false;$('confirm-delete-all-btn').textContent='Delete permanently';renderTable();}
}
async function restoreOne(id) {
  const row=allArchived.find(r=>r.docId===id);
  if (!row) return;
  if (!row.parentDocId || !row.id) throw new Error(`Student ${row.id||id} is missing its original section reference.`);
  const {archivedAt, expiresAt, status, docId, ...payload}=row;
  const batch=writeBatch(db);
  batch.set(doc(db,'sections',row.parentDocId,'classList',String(row.id)),payload);
  batch.delete(doc(db,'archivedStudents',id));
  await batch.commit();
}
async function restoreIds(ids) {
  if(busy || !ids.length) return;
  busy=true;toggleLoading(true);
  let success=0; const failures=[];
  try {
    for(const id of ids){
      try{await restoreOne(id);selected.delete(id);success++;}
      catch(e){console.error('Restore failed',id,e);failures.push(id);}
    }
    if(failures.length) alert(`${success} restored. ${failures.length} could not be restored; check missing section IDs or permissions.`);
  } finally {busy=false;toggleLoading(false);renderTable();}
}
async function clearExpiredWhileOpen() {
  // Backup cleanup only. Firestore TTL is required for unattended deletion.
  if (cleanupRunning || busy) return;
  const expired=allArchived.filter(r => {const exp=archiveExpires(r);return exp !== null && exp<=Date.now();}).map(r=>r.docId);
  if (!expired.length) return;
  cleanupRunning=true;
  try { await deleteArchived(expired); }
  catch(e) {console.warn('Client expiry cleanup not permitted or failed. Configure Firestore TTL for unattended cleanup.',e);}
  finally{cleanupRunning=false;}
}
function listenArchive() {
  unsubscribeArchives?.();
  unsubscribeArchives=onSnapshot(collection(db,'archivedStudents'), snap => {
    allArchived=snap.docs.map(d=>({...d.data(),docId:d.id}));
    renderTable();
    void clearExpiredWhileOpen();
  },err=>{console.error('Archive listener failed',err);$('archived-students-table').innerHTML='<tr><td colspan="5" class="archive-empty">Unable to load archived records.</td></tr>';});
}
onAuthStateChanged(auth,user=>{
  const verified=user && (localStorage.getItem(VERIFIED_KEY)===user.uid || sessionStorage.getItem(VERIFIED_KEY)===user.uid);
  if(!verified){unsubscribeArchives?.();window.location.href='../Login/Login.html';return;}
  listenArchive();
});
$('archived-students-table').addEventListener('change',e=>{
  const control=e.target.closest('.archive-item-check');if(!control || busy)return;
  control.checked?selected.add(control.dataset.id):selected.delete(control.dataset.id);
  renderTable();
});
$('archive-select-all').addEventListener('change',e=>{
  if (busy) return;
  getVisible().forEach(r=>{if(e.target.checked)selected.add(r.docId);else selected.delete(r.docId);});
  renderTable();
});
$('search-archive').addEventListener('input',renderTable);
$('delete-all-btn').addEventListener('click',()=>showDelete(allArchived.map(r=>r.docId)));
$('delete-selected-btn').addEventListener('click',()=>showDelete([...selected]));
$('restore-selected-btn').addEventListener('click',()=>void restoreIds([...selected]));
$('archive-cancel-delete').addEventListener('click',window.closeDeleteAllModal);
$('confirm-delete-all-btn').addEventListener('click',()=>void handleDelete());
setInterval(()=>{renderTable();void clearExpiredWhileOpen();},60*1000);
window.showLogoutPopup=()=>$('logout-popup').style.display='flex';
window.closeLogoutPopup=()=>$('logout-popup').style.display='none';
window.logoutUser=async()=>{
  unsubscribeArchives?.();
  try {await signOut(auth);localStorage.removeItem(VERIFIED_KEY);sessionStorage.removeItem(VERIFIED_KEY);window.location.href='../index.html';}
  catch(e){console.error('Logout failed',e);alert('Unable to log out. Please try again.');}
};
function applyTheme(theme){document.documentElement.setAttribute('data-theme',theme);const icon=$('theme-toggle')?.querySelector('i');if(icon)icon.className=theme==='dark'?'bi bi-sun-fill':'bi bi-moon-stars-fill';}
applyTheme(localStorage.getItem('dashboard-theme')||'light');
$('theme-toggle')?.addEventListener('click',()=>{const t=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';localStorage.setItem('dashboard-theme',t);applyTheme(t);});
window.addEventListener('storage',e=>{if(e.key==='dashboard-theme')applyTheme(e.newValue||'light');});
