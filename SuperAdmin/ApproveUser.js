// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    setDoc, 
    deleteDoc, 
    doc, 
    updateDoc, 
    getDoc,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signOut,
    sendPasswordResetEmail // Added for password reset functionality
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// Firebase Config
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
const auth = getAuth(app);

// --- ELEMENTS ---
const approvedTable = document.getElementById("approvedTable");
const removeUsersBtn = document.getElementById("removeUsersBtn");
const openArchiveBtn = document.getElementById("openArchiveBtn");
const addSectionBtn = document.getElementById("addSectionBtn");
const editSectionBtn = document.getElementById("editSection");
const removeSectionBtn = document.getElementById("archiveSectiom"); 
const archiveSectionBtn = document.getElementById("archiveSec"); 
const sectionModal = document.getElementById("sectionModal");
const sectionInput = document.getElementById("sectionInput");
const saveSectionBtn = document.getElementById("saveSectionBtn");
const cancelSectionBtn = document.getElementById("cancelSectionBtn");
const loadingOverlay = document.getElementById("loading-overlay");
const resetPasswordBtn = document.getElementById("resetPasswordBtn"); // New Element

// --- LOADING HELPER ---
const toggleLoading = (show) => {
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? "flex" : "none";
    }
};

window.showLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "flex";
    }
};

window.closeLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "none";
    }
};

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

// --- MODALS ---

// 1. Remove Section Modal
const deleteSectionModal = document.createElement("div");
deleteSectionModal.className = "modal hidden";
deleteSectionModal.innerHTML = `
    <div class="modal-box sa-section-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-remove-title">
        <div class="sa-section-heading"><div class="sa-section-icon danger-icon"><i class="bi bi-folder-minus"></i></div><div><span class="sa-section-eyebrow">MANAGE SECTIONS</span><h3 id="sa-remove-title">Remove Sections</h3><p>Choose which sections to move to the archive.</p></div></div>
        <div class="sa-section-alert"><i class="bi bi-info-circle"></i><span>Removing a section unassigns it from its users. Its name remains recoverable in Archived Sections.</span></div>
        <div class="sa-section-listbar"><b>Available sections</b><label class="sa-section-selectall"><input id="saSelectAllSections" type="checkbox"> Select all</label></div>
        <div id="deleteSectionList" class="sa-section-options"></div>
        <div class="sa-section-bottom"><small id="saRemoveSelectionCount">0 sections selected</small><div class="modal-actions"><button id="cancelDeleteSections" class="sa-section-cancel reject">Cancel</button><button id="confirmDeleteSections" class="sa-section-danger"><i class="bi bi-folder-minus"></i> Remove Selected</button></div></div>
    </div>
`;
document.body.appendChild(deleteSectionModal);
const deleteSectionList = deleteSectionModal.querySelector("#deleteSectionList");
const confirmDeleteSections = deleteSectionModal.querySelector("#confirmDeleteSections");
const cancelDeleteSections = deleteSectionModal.querySelector("#cancelDeleteSections");

// 2. Archive View Modal
const viewArchiveModal = document.createElement("div");
// Required by archive styling, including the compact Archived Sections layout.
viewArchiveModal.id = "viewArchiveModal";
viewArchiveModal.className = "modal hidden";
viewArchiveModal.innerHTML = `
    <div class="modal-box sa-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archiveModalTitle">
        <div class="sa-archive-top"><div><h3 id="archiveModalTitle">Archived Users</h3><p class="sa-archive-subtitle">Restore users within seven days, or manage archived records securely.</p></div><button type="button" id="closeArchiveView" class="sa-archive-close" aria-label="Close archive"><i class="bi bi-x-lg"></i></button></div>
        <div id="saArchiveStudentView">
          <div class="sa-archive-metrics">
            <div class="sa-archive-metric"><span><i class="bi bi-archive"></i> Archived</span><strong id="saArchiveTotal">0</strong><small>Currently stored records</small></div>
            <div class="sa-archive-metric"><span><i class="bi bi-hourglass-split"></i> Expiring soon</span><strong id="saArchiveExpiring">0</strong><small>Less than 24 hours remaining</small></div>
            <div class="sa-archive-metric"><span><i class="bi bi-check2-square"></i> Selected</span><strong id="saArchiveSelected">0</strong><small>Checked user records</small></div>
          </div>
          <div class="sa-archive-notice"><i class="bi bi-shield-check"></i><p>Users can be restored for <b>7 days</b> after archiving. Automatic background Firestore deletion requires the TTL policy on <b>archivedUsers.expiresAt</b>. Firebase Authentication deletion requires a secure backend.</p></div>
          <div class="sa-archive-list-panel"><div class="sa-archive-panel-heading"><div><h3>Archived Users</h3><small id="saArchiveResultCount">0 records shown</small></div><label class="sa-archive-search"><i class="bi bi-search"></i><input id="saArchiveSearch" type="search" placeholder="Search email or section..." aria-label="Search archived users"></label></div>
        </div>
        </div>
        <p id="archiveMessage" class="sa-archive-message"></p>
        <div id="dynamicArchiveList" class="sa-archive-list"></div>
    </div>
`;
document.body.appendChild(viewArchiveModal);
const dynamicArchiveList = viewArchiveModal.querySelector("#dynamicArchiveList");
const archiveModalTitle = viewArchiveModal.querySelector("#archiveModalTitle");
const archiveMessage = viewArchiveModal.querySelector("#archiveMessage");
const closeArchiveView = viewArchiveModal.querySelector("#closeArchiveView");

// 3. Edit Section Modal
const editSectionModal = document.createElement("div");
editSectionModal.className = "modal hidden";
editSectionModal.innerHTML = `
    <div class="modal-box sa-section-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-edit-title">
        <div class="sa-section-heading"><div class="sa-section-icon"><i class="bi bi-pencil-square"></i></div><div><span class="sa-section-eyebrow">MANAGE SECTIONS</span><h3 id="sa-edit-title">Edit Section</h3><p>Select a section below to update its name.</p></div></div>
        <div class="sa-section-alert"><i class="bi bi-info-circle"></i><span>Changes also update the section names assigned to approved users.</span></div>
        <div class="sa-section-listbar"><b>Choose a section</b><small>Select one</small></div>
        <div id="editSectionList" class="sa-section-options"></div>
        <div class="sa-section-bottom"><div class="modal-actions"><button id="cancelEditSections" class="sa-section-cancel reject">Cancel</button><button id="confirmEditSections" class="sa-section-primary approve"><i class="bi bi-check2-circle"></i> Save Changes</button></div></div>
    </div>
`;
document.body.appendChild(editSectionModal);
const editSectionList = editSectionModal.querySelector("#editSectionList");
const confirmEditSections = editSectionModal.querySelector("#confirmEditSections");
const cancelEditSections = editSectionModal.querySelector("#cancelEditSections");

let sections = [{ id: null, name: "No Section" }];

// --- UTILS ---
async function showCustomConfirm(message) {
    return new Promise(resolve => {
        const modal = document.createElement("div");
        modal.className = "custom-confirm";
        modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999";
        modal.innerHTML = `
            <div class="modal-box" style="background:white;padding:20px;border-radius:10px;min-width:300px;text-align:center;">
                <p>${message}</p>
                <div style="margin-top:15px; display:flex; justify-content:center; gap:10px;">
                    <button class="approve yesBtn">Yes</button>
                    <button class="reject noBtn">No</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector(".yesBtn").onclick = () => { document.body.removeChild(modal); resolve(true); };
        modal.querySelector(".noBtn").onclick = () => { document.body.removeChild(modal); resolve(false); };
    });
}

async function loadSections() {
    const snapshot = await getDocs(collection(db, "sections"));
    sections = [{ id: null, name: "No Section" }];
    snapshot.forEach(docSnap => sections.push({ id: docSnap.id, name: docSnap.data().name }));
}

// --- USER ARCHIVE (CHECKBOX RESTORE / PERMANENT DELETE) ---
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const archiveActions = document.createElement('div');
archiveActions.className = 'archive-toolbar';
archiveActions.innerHTML = `
    <label class="archive-select-all"><input type="checkbox" id="selectAllArchivedUsers" aria-label="Select all archived users"> Select All</label>
    <span id="archiveSelectedCount">0 selected</span>
    <button type="button" id="restoreArchivedSelected" class="approve">Restore & Auth Selected</button>
    <button type="button" id="deleteArchivedSelected" class="reject"><i class="bi bi-trash3"></i> Delete Selected</button>
    <button type="button" id="deleteAllArchived" class="sa-archive-delete-all"><i class="bi bi-trash"></i> Delete All</button>
`;
document.querySelector('.sa-archive-list-panel').appendChild(archiveActions);
archiveActions.hidden = true;
const selectAllArchivedUsers = archiveActions.querySelector('#selectAllArchivedUsers');
const archiveSelectedCount = archiveActions.querySelector('#archiveSelectedCount');
const restoreArchivedSelected = archiveActions.querySelector('#restoreArchivedSelected');
const deleteArchivedSelected = archiveActions.querySelector('#deleteArchivedSelected');
const saArchiveStudentView = document.getElementById('saArchiveStudentView');
const saArchiveSearch = document.getElementById('saArchiveSearch');
const saArchiveTotal = document.getElementById('saArchiveTotal');
const saArchiveExpiring = document.getElementById('saArchiveExpiring');
const saArchiveSelected = document.getElementById('saArchiveSelected');
const saArchiveResultCount = document.getElementById('saArchiveResultCount');
const deleteAllArchived = archiveActions.querySelector('#deleteAllArchived');
let archiveRecords = [];
const archivedUserChecks = () => Array.from(dynamicArchiveList.querySelectorAll('.archived-user-check'));
function syncArchiveCount() {
    const checks = archivedUserChecks();
    const count = checks.filter(c => c.checked).length;
    archiveSelectedCount.textContent = `${count} selected`;
    saArchiveSelected.textContent = String(count);
    dynamicArchiveList.querySelectorAll('tr[data-archive-row]').forEach(row => row.classList.toggle('selected-row', !!row.querySelector('.archived-user-check:checked')));
    restoreArchivedSelected.disabled = count === 0;
    deleteArchivedSelected.disabled = count === 0;
    selectAllArchivedUsers.checked = checks.length > 0 && count === checks.length;
    selectAllArchivedUsers.indeterminate = count > 0 && count < checks.length;
}
selectAllArchivedUsers.addEventListener('change', () => {
    archivedUserChecks().forEach(cb => { cb.checked = selectAllArchivedUsers.checked; });
    syncArchiveCount();
});
dynamicArchiveList.addEventListener('change', e => {
    if (e.target.classList.contains('archived-user-check')) syncArchiveCount();
});
function getCheckedArchivedIds() {
    return archivedUserChecks().filter(c => c.checked).map(c => c.value);
}
async function showNotice(message, title='Selection Required') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'archive-alert-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'archive-alert';
        const heading = document.createElement('h3'); heading.textContent = title;
        const text = document.createElement('p'); text.textContent = message;
        const ok = document.createElement('button'); ok.type = 'button'; ok.className='approve'; ok.textContent='OK';
        dialog.append(heading,text,ok); overlay.append(dialog); document.body.append(overlay);
        ok.focus(); ok.addEventListener('click', () => { overlay.remove(); resolve(); });
    });
}
async function confirmArchiveAction(title, details, confirmText) {
    return new Promise(resolve => {
        const overlay = document.createElement('div'); overlay.className='archive-alert-overlay';
        const dialog = document.createElement('div'); dialog.className='archive-alert';
        const h = document.createElement('h3'); h.textContent=title;
        const p = document.createElement('p'); p.textContent=details;
        const actions=document.createElement('div'); actions.className='archive-alert-actions';
        const cancel=document.createElement('button'); cancel.textContent='Cancel';
        const confirm=document.createElement('button'); confirm.textContent=confirmText; confirm.className='reject';
        actions.append(cancel,confirm); dialog.append(h,p,actions); overlay.append(dialog); document.body.append(overlay);
        const done = value => { overlay.remove(); resolve(value); };
        cancel.onclick=()=>done(false); confirm.onclick=()=>done(true);
        cancel.focus();
    });
}
function archiveDate(data) {
    const raw=data.archivedAt;
    const millis=raw?.toMillis ? raw.toMillis() : (typeof raw === 'number' ? raw : Date.parse(raw || ''));
    return Number.isFinite(millis) ? millis : null;
}
// Opportunistic cleanup when page is open. For guaranteed unattended cleanup,
// configure Firestore TTL on archivedUsers.expiresAt (see README).
async function cleanupExpiredArchivedUsers() {
    const snapshot=await getDocs(collection(db,'archivedUsers'));
    let removed=0;
    for (const item of snapshot.docs) {
        const d=item.data();
        const timestamp=archiveDate(d);
        if (timestamp !== null && Date.now() >= timestamp + SEVEN_DAYS_MS) {
            await deleteDoc(item.ref);
            removed++;
        } else if (timestamp !== null && !d.expiresAt) {
            // Firebase TTL requires a Timestamp. Firebase Timestamp.fromMillis imported below.
            await updateDoc(item.ref,{expiresAt: Timestamp.fromMillis(timestamp+SEVEN_DAYS_MS)});
        }
    }
    return removed;
}
function renderArchiveTable() {
    const search=(saArchiveSearch.value || '').trim().toLowerCase();
    const rows=archiveRecords.filter(item => {
        const d=item.data;
        return [d.email,item.id,Array.isArray(d.section)?d.section.join(' '):d.section || ''].join(' ').toLowerCase().includes(search);
    });
    saArchiveTotal.textContent=String(archiveRecords.length);
    saArchiveExpiring.textContent=String(archiveRecords.filter(({data})=>{const t=archiveDate(data);return t !== null && (t+SEVEN_DAYS_MS-Date.now())<=86400000;}).length);
    saArchiveResultCount.textContent=`${rows.length} record${rows.length===1?'':'s'} shown`;
    dynamicArchiveList.replaceChildren();
    const table=document.createElement('table'); table.className='sa-archive-table';
    const thead=document.createElement('thead');
    thead.innerHTML='<tr><th aria-label="Select"><i class="bi bi-check2-square"></i></th><th>User</th><th>Section</th><th>Date Archived</th><th>Expires In</th></tr>';
    const tbody=document.createElement('tbody');
    for (const item of rows) {
        const d=item.data, when=archiveDate(d);
        const tr=document.createElement('tr');tr.dataset.archiveRow=item.id;
        const checkboxCell=document.createElement('td');
        const cb=document.createElement('input');cb.type='checkbox';cb.className='archived-user-check';cb.value=item.id;cb.setAttribute('aria-label','Select '+(d.email||item.id));checkboxCell.append(cb);
        const userCell=document.createElement('td');
        const email=document.createElement('strong');email.className='sa-archive-email';email.textContent=d.email||'Unknown user';
        const id=document.createElement('small');id.className='sa-archive-id';id.textContent='ID: '+(d.originalApprovedId||item.id);
        userCell.append(email,id);
        const sectionCell=document.createElement('td');sectionCell.textContent=Array.isArray(d.section)?d.section.join(', '):(d.section||'No Section');
        const dateCell=document.createElement('td');dateCell.textContent=when?new Date(when).toLocaleString():'Not recorded';
        const expiresCell=document.createElement('td');
        const status=document.createElement('span');status.className='sa-archive-status';
        if(when===null){status.textContent='Unknown';status.classList.add('unknown');}
        else {const remaining=when+SEVEN_DAYS_MS-Date.now();if(remaining<=0){status.textContent='Expired';status.classList.add('expired');}
        else if(remaining<=86400000){status.textContent=`${Math.ceil(remaining/3600000)}h left`;status.classList.add('soon');}
        else {status.textContent=`${Math.ceil(remaining/86400000)} days left`;status.classList.add('safe');}}
        expiresCell.append(status);tr.append(checkboxCell,userCell,sectionCell,dateCell,expiresCell);tbody.append(tr);
    }
    if(!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.className='sa-archive-empty';td.textContent=archiveRecords.length?'No archived users match your search.':'No archived users.';tr.append(td);tbody.append(tr);}
    table.append(thead,tbody);dynamicArchiveList.append(table);
    selectAllArchivedUsers.checked=false;syncArchiveCount();
    deleteAllArchived.disabled=!archiveRecords.length;
}
async function renderArchivedUsers() {
    saArchiveStudentView.hidden=false;
    archiveActions.hidden=false;
    dynamicArchiveList.textContent='Loading archived users...';
    try {
        await cleanupExpiredArchivedUsers();
        const snapshot=await getDocs(collection(db,'archivedUsers'));
        archiveRecords=snapshot.docs.map(item=>({id:item.id,data:item.data()}));
        renderArchiveTable();
    }catch(error){console.error('Archive load failed',error);dynamicArchiveList.textContent='Unable to load archive. Check permissions and connection.';}
}
saArchiveSearch.addEventListener('input',renderArchiveTable);
deleteAllArchived.addEventListener('click',()=>deleteArchivedUsers(archiveRecords.map(r=>r.id)));
openArchiveBtn?.addEventListener('click',async()=>{
    viewArchiveModal.classList.remove('sa-sections-archive-mode');
    viewArchiveModal.querySelector('.sa-archive-subtitle').textContent='Restore users within seven days, or manage archived records securely.';
    archiveModalTitle.textContent='Archived Users';
    archiveMessage.textContent='Select a user, or use Select All to manage multiple accounts. Restoring returns users to approved records.';
    saArchiveSearch.value='';
    viewArchiveModal.classList.remove('hidden');
    await renderArchivedUsers();
});
async function restoreArchivedUsers(ids) {
    if (!ids.length) return showNotice('Please select at least one person from the archived-user checklist.');
    const confirmed=await confirmArchiveAction('Restore Archived Users',`Restore ${ids.length} selected user(s) to approvedUsers? Their existing Firebase Authentication accounts must already exist; this page cannot securely recreate deleted Auth users.`, 'Restore');
    if (!confirmed) return;
    toggleLoading(true);
    const errors=[];
    try {
        for(const id of ids) {
            try {
                const archivedRef=doc(db,'archivedUsers',id);
                const snap=await getDoc(archivedRef);
                if (!snap.exists()) continue;
                const data={...snap.data()};
                delete data.archivedAt; delete data.expiresAt;
                // Do not overwrite an active user record on a conflicting ID.
                const restoredId=data.originalApprovedId || id;
                delete data.originalApprovedId;
                const existing=await getDoc(doc(db,'approvedUsers',restoredId));
                if(existing.exists()) { errors.push(`${data.email||id}: already approved`); continue; }
                await setDoc(doc(db,'approvedUsers',restoredId),data);
                await deleteDoc(archivedRef);
            } catch(e) { errors.push(`${id}: ${e.message}`); }
        }
        await renderArchivedUsers(); await loadApprovedUsers();
        await showNotice(errors.length ? 'Some restorations failed: '+errors.join('; ') : `${ids.length} user(s) restored to approved users. Check Authentication access separately.`, errors.length?'Partial Restoration':'Restoration Complete');
    } finally { toggleLoading(false); }
}
async function deleteArchivedUsers(ids) {
    if(!ids.length) return showNotice('Please select at least one person from the archived-user checklist.');
    const confirmed=await confirmArchiveAction('Permanently Delete Users',`Delete ${ids.length} selected archived Firestore record(s)? This cannot be undone. This does NOT delete Firebase Authentication accounts, which require Firebase Admin SDK.`, 'Delete Permanently');
    if(!confirmed) return;
    toggleLoading(true); const errors=[];
    try {
        for(const id of ids) {
            try { await deleteDoc(doc(db,'archivedUsers',id)); }
            catch(e) { errors.push(`${id}: ${e.message}`); }
        }
        await renderArchivedUsers();
        await showNotice(errors.length ? 'Some deletions failed: '+errors.join('; ') : `${ids.length} archived Firestore record(s) deleted. Authentication accounts were not deleted.`, errors.length?'Partial Deletion':'Records Deleted');
    } finally { toggleLoading(false); }
}
restoreArchivedSelected.addEventListener('click',()=>restoreArchivedUsers(getCheckedArchivedIds()));
deleteArchivedSelected.addEventListener('click',()=>deleteArchivedUsers(getCheckedArchivedIds()));

// --- SECTION ARCHIVE ---
archiveSectionBtn?.addEventListener("click", async () => {
    archiveActions.hidden = true;
    saArchiveStudentView.hidden = true;
    viewArchiveModal.classList.add('sa-sections-archive-mode');
    viewArchiveModal.querySelector('.sa-archive-subtitle').textContent = 'Find and restore sections that were previously removed.';
    archiveModalTitle.textContent = "Archived Sections";
    archiveMessage.textContent = "Restore a section from the archive. Archived section records are retained according to your configured Firestore cleanup policy.";
    dynamicArchiveList.innerHTML = '<div class="sa-section-loading">Loading archived sections...</div>';
    viewArchiveModal.classList.remove("hidden");
    try {
        const snapshot = await getDocs(collection(db, "archivedSections"));
        dynamicArchiveList.replaceChildren();
        const wrap = document.createElement('div');wrap.className='sa-section-archive';
        const metrics = document.createElement('div');metrics.className='sa-section-metrics';
        const totalMetric=document.createElement('div');totalMetric.className='sa-section-metric';
        totalMetric.innerHTML='<span><i class="bi bi-archive"></i> Archived sections</span><strong></strong><small>Stored section records</small>';
        totalMetric.querySelector('strong').textContent=String(snapshot.size);
        const visibleMetric=document.createElement('div');visibleMetric.className='sa-section-metric';
        visibleMetric.innerHTML='<span><i class="bi bi-search"></i> Results</span><strong id="saSectionVisibleCount">0</strong><small>Matching your search</small>';
        metrics.append(totalMetric,visibleMetric);wrap.append(metrics);
        const tools = document.createElement('div');tools.className='sa-section-archive-tools';
        const count = document.createElement('strong');count.textContent=`${snapshot.size} archived section${snapshot.size===1?'':'s'}`;
        const search = document.createElement('input');search.type='search';search.placeholder='Search archived sections...';search.setAttribute('aria-label','Search archived sections');
        const searchBox=document.createElement('div');searchBox.className='sa-section-searchbox';
        searchBox.innerHTML='<i class="bi bi-search" aria-hidden="true"></i>';searchBox.append(search);
        tools.append(count,searchBox);wrap.append(tools);
        const header=document.createElement('div');header.className='sa-section-table-heading';
        header.innerHTML='<span>SECTION</span><span>DATE ARCHIVED</span><span>ACTION</span>';
        wrap.append(header);
        const list=document.createElement('div');list.className='sa-section-archive-list';wrap.append(list);
        const entries=snapshot.docs.map(d=>({id:d.id,...d.data()}));
        const render=()=>{
            list.replaceChildren();let visible=0;
            for(const entry of entries){if(!(entry.name||'').toLowerCase().includes(search.value.trim().toLowerCase())) continue;visible++;
                const row=document.createElement('div');row.className='sa-section-archive-row';
                const info=document.createElement('div');info.className='sa-section-archive-info';
                const name=document.createElement('strong');name.textContent=entry.name||'Unnamed section';
                const date=document.createElement('small');date.className='sa-section-date';
                const rawDate=entry.archivedAt?.toDate?.() ?? entry.archivedAt;
                const parsed=rawDate ? new Date(rawDate) : null;
                date.textContent=parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Date not recorded';
                info.append(name);
                const btn=document.createElement('button');btn.type='button';btn.className='sa-section-primary';btn.innerHTML='<i class="bi bi-arrow-counterclockwise"></i> Restore';
                btn.addEventListener('click',async()=>{
                    if(!(await showCustomConfirm(`Restore section "${entry.name||'Unnamed section'}"?`)))return;
                    toggleLoading(true);
                    try{await setDoc(doc(collection(db,'sections')),{name:entry.name});await deleteDoc(doc(db,'archivedSections',entry.id));
                        viewArchiveModal.classList.add('hidden');await initializeDashboard();}
                    catch(error){console.error(error);await showNotice('Could not restore section: '+error.message);}
                    finally{toggleLoading(false);}
                });
                row.append(info,date,btn);list.append(row);
            }
            visibleMetric.querySelector('strong').textContent=String(visible);count.textContent=`${visible} of ${snapshot.size} section${snapshot.size===1?'':'s'} shown`;
            if(!visible){const empty=document.createElement('div');empty.className='sa-section-empty';const symbol=document.createElement('i');symbol.className=entries.length?'bi bi-search':'bi bi-archive';const title=document.createElement('strong');title.textContent=entries.length?'No matching sections':'Your archive is empty';const hint=document.createElement('p');hint.textContent=entries.length?'Try a different section name.':'Sections you remove will appear here and can be restored.';empty.append(symbol,title,hint);list.append(empty);}
        };
        search.addEventListener('input',render);render();dynamicArchiveList.append(wrap);
    }catch(error){console.error(error);dynamicArchiveList.textContent='Unable to load archived sections. Check your connection.';}
});

closeArchiveView?.addEventListener("click", () => viewArchiveModal.classList.add("hidden"));

// --- SECTION MANAGEMENT ---
addSectionBtn?.addEventListener("click", () => {
    sectionInput.value = "";
    sectionModal.classList.remove("hidden");
});

saveSectionBtn?.addEventListener("click", async () => {
    const name = sectionInput.value.trim();
    if (!name) return alert("Enter section name");

    const isDuplicate = sections.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return alert(`The section "${name}" already exists!`);

    toggleLoading(true);
    await setDoc(doc(collection(db, "sections")), { name });
    sectionModal.classList.add("hidden");
    await initializeDashboard();
    toggleLoading(false);
});

editSectionBtn?.addEventListener("click", async () => {
    toggleLoading(true);
    await loadSections();
    toggleLoading(false);
    editSectionList.innerHTML = "";
    sections.filter(s => s.id).forEach(sec => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex; align-items:center; margin-bottom:8px;";
        label.innerHTML = `
            <input type="radio" name="editSectionRadio" value="${sec.id}" data-name="${sec.name}" style="margin-right:10px;">
            <span class="name-display">${sec.name}</span>
            <input type="text" class="edit-input" value="${sec.name}" style="display:none; flex:1; padding:5px;">
        `;
        const radio = label.querySelector('input[type="radio"]');
        radio.addEventListener("change", () => {
            editSectionList.querySelectorAll(".edit-input").forEach(i => i.style.display = "none");
            editSectionList.querySelectorAll(".name-display").forEach(s => s.style.display = "block");
            label.querySelector(".edit-input").style.display = "block";
            label.querySelector(".name-display").style.display = "none";
        });
        editSectionList.appendChild(label);
    });
    editSectionModal.classList.remove("hidden");
});

confirmEditSections?.addEventListener("click", async () => {
    const selected = editSectionList.querySelector("input[type='radio']:checked");
    if (!selected) return alert("Select a section");

    const newName = selected.parentElement.querySelector(".edit-input").value.trim();
    const oldName = selected.dataset.name;
    const sectionId = selected.value;

    if (!newName) return alert("Enter name");
    if (newName === oldName) return editSectionModal.classList.add("hidden");

    const isDuplicate = sections.some(s => s.id !== sectionId && s.name.toLowerCase() === newName.toLowerCase());
    if (isDuplicate) return alert(`Cannot rename to "${newName}" because that section already exists.`);

    toggleLoading(true);
    try {
        await updateDoc(doc(db, "sections", sectionId), { name: newName });
        const usersSnapshot = await getDocs(collection(db, "approvedUsers"));
        const updatePromises = usersSnapshot.docs.map(async (userDoc) => {
            const userData = userDoc.data();
            let userSections = userData.section || [];
            if (userSections.includes(oldName)) {
                const updatedSections = userSections.map(s => s === oldName ? newName : s);
                return updateDoc(doc(db, "approvedUsers", userDoc.id), { section: updatedSections });
            }
        });
        await Promise.all(updatePromises);
        editSectionModal.classList.add("hidden");
        await initializeDashboard();
    } catch (error) {
        console.error("Error:", error);
    } finally {
        toggleLoading(false);
    }
});

removeSectionBtn?.addEventListener("click", async () => {
    toggleLoading(true);
    await loadSections();
    toggleLoading(false);
    deleteSectionList.innerHTML = "";
    sections.filter(s => s.id).forEach(sec => {
        const label = document.createElement("label");
        label.style.display = "block";
        label.innerHTML = `<input type="checkbox" value="${sec.id}" data-name="${sec.name}"> ${sec.name}`;
        deleteSectionList.appendChild(label);
    });
    const allBox=deleteSectionModal.querySelector('#saSelectAllSections');
    allBox.checked=false;
    const updateCount=()=>{
        const checks=[...deleteSectionList.querySelectorAll('input[type="checkbox"]')];
        const n=checks.filter(x=>x.checked).length;
        deleteSectionModal.querySelector('#saRemoveSelectionCount').textContent=`${n} section${n===1?'':'s'} selected`;
        allBox.checked=!!checks.length && n===checks.length;
        allBox.indeterminate=n>0 && n<checks.length;
    };
    allBox.onchange=()=>{deleteSectionList.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=allBox.checked);updateCount();};
    deleteSectionList.onchange=updateCount;updateCount();
    deleteSectionModal.classList.remove("hidden");
});

confirmDeleteSections?.addEventListener("click", async () => {
    const selected = Array.from(deleteSectionList.querySelectorAll("input:checked"));
    if (!selected.length) return showNotice('Please select at least one section from the checklist.', 'Select a Section');
    if (!(await showCustomConfirm(`Archive ${selected.length} sections?`))) return;

    toggleLoading(true);
    for (const cb of selected) {
        await setDoc(doc(collection(db, "archivedSections")), { name: cb.dataset.name, archivedAt: new Date().toISOString() });
        await deleteDoc(doc(db, "sections", cb.value));

        const usersSnapshot = await getDocs(collection(db, "approvedUsers"));
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            let userSections = userData.section || [];
            if (userSections.includes(cb.dataset.name)) {
                const updated = userSections.filter(s => s !== cb.dataset.name);
                await updateDoc(doc(db, "approvedUsers", userDoc.id), { section: updated.length ? updated : ["No Section"] });
            }
        }
    }
    deleteSectionModal.classList.add("hidden");
    await initializeDashboard();
    toggleLoading(false);
});

// --- PASSWORD RESET LOGIC ---
// Global to hold admin data for the modal
let allAdmins = [];

window.openAdminResetModal = async function() {
    const modal = document.getElementById("admin-reset-modal");
    const searchInput = document.getElementById("admin-search-input");
    const listSelect = document.getElementById("admin-list-select");

    // Reset UI
    document.getElementById("admin-step-1").style.display = "block";
    document.getElementById("admin-step-2").style.display = "none";
    searchInput.value = "";
    modal.style.display = "flex";

    toggleLoading(true);
    try {
        // Fetch all approved admins
        const snap = await getDocs(collection(db, "approvedUsers"));
        allAdmins = [];
        snap.forEach(doc => {
            allAdmins.push({ docId: doc.id, ...doc.data() });
        });

        renderAdminList(""); // Initial render
    } catch (error) {
        console.error("Error fetching admins:", error);
        alert("Failed to load admin list.");
    } finally {
        toggleLoading(false);
    }

    // Live search listener
    searchInput.oninput = (e) => renderAdminList(e.target.value.toLowerCase());
};

function renderAdminList(term) {
    const listSelect = document.getElementById("admin-list-select");
    listSelect.innerHTML = "";

    // Filter ONLY by email now
    const filtered = allAdmins.filter(a => 
        a.email && a.email.toLowerCase().includes(term)
    );

    if (filtered.length === 0) {
        listSelect.innerHTML = '<option disabled>No matching emails found...</option>';
    } else {
        filtered.forEach(admin => {
            const opt = document.createElement("option");
            opt.value = admin.docId;
            // Display only the email in the list
            opt.textContent = admin.email;
            listSelect.appendChild(opt);
        });
    }
}

window.confirmAdminSelection = function() {
    const docId = document.getElementById("admin-list-select").value;
    if (!docId) return alert("Please select an email from the list!");

    const admin = allAdmins.find(a => a.docId === docId);
    
    document.getElementById("admin-step-1").style.display = "none";
    document.getElementById("admin-step-2").style.display = "block";
    
    // Warning text now uses only the email
    document.getElementById("admin-confirm-text").innerHTML = 
        `You are changing the password for the account: <strong>${admin.email}</strong>. This will affect their login access immediately.`;

    document.getElementById("final-admin-reset-btn").onclick = () => saveAdminPassword(admin);
};

window.closeAdminResetModal = () => document.getElementById("admin-reset-modal").style.display = "none";

window.confirmAdminSelection = function() {
    const docId = document.getElementById("admin-list-select").value;
    if (!docId) return alert("Please select an admin account!");

    const admin = allAdmins.find(a => a.docId === docId);
    
    document.getElementById("admin-step-1").style.display = "none";
    document.getElementById("admin-step-2").style.display = "block";
    document.getElementById("admin-confirm-text").innerHTML = 
        `You are changing the password for <strong>${admin.name}</strong> (${admin.email}). This will affect their login access to the dashboard.`;

    document.getElementById("final-admin-reset-btn").onclick = () => saveAdminPassword(admin);
};

window.backToAdminStep1 = () => {
    document.getElementById("admin-step-1").style.display = "block";
    document.getElementById("admin-step-2").style.display = "none";
};

async function saveAdminPassword(admin) {
    const newPass = document.getElementById("admin-new-pass").value.trim();
    if (newPass.length < 6) return alert("Security Requirement: Admin passwords must be at least 6 characters.");

    toggleLoading(true);
    try {
        const adminRef = doc(db, "approvedUsers", admin.docId);
        await updateDoc(adminRef, {
            password: newPass
        });

        alert(`Successfully updated password for ${admin.name}.`);
        closeAdminResetModal();
    } catch (error) {
        console.error("Admin Update Error:", error);
        alert("Permission denied or connection error.");
    } finally {
        toggleLoading(false);
    }
}

// --- INITIALIZATION ---
async function initializeDashboard() {
    toggleLoading(true);
    await loadSections();
    await loadApprovedUsers();
    toggleLoading(false);
}

// --- USER TABLE & ARCHIVE LOGIC ---
async function loadApprovedUsers() {
    const snapshot = await getDocs(collection(db, "approvedUsers"));
    approvedTable.innerHTML = "";
    
    if (snapshot.empty) {
        approvedTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:gray;">No approved users found.</td></tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const row = document.createElement("tr");
        const multiSelect = createMultiSelect(data.section || []);
        row.innerHTML = `
            <td><input type="checkbox" class="approvedCheck" data-id="${docSnap.id}"></td>
            <td>${data.email}</td>
            <td class="select-col"></td>
            <td><button class="saveBtn" data-id="${docSnap.id}">Save</button></td>
        `;
        row.querySelector(".select-col").appendChild(multiSelect);
        approvedTable.appendChild(row);
    });

    document.querySelectorAll(".saveBtn").forEach(btn => btn.addEventListener("click", async () => {
        toggleLoading(true);
        const container = btn.closest("tr").querySelector(".multi-select-container");
        const selected = Array.from(container.querySelectorAll("input:checked")).map(c => c.value);
        await updateDoc(doc(db, "approvedUsers", btn.dataset.id), { section: selected.length ? selected : ["No Section"] });
        toggleLoading(false);
        alert("Updated!");
    }));
}

removeUsersBtn?.addEventListener("click", async () => {
    const selected = Array.from(document.querySelectorAll(".approvedCheck:checked"));
    if (!selected.length) {
        await showNotice('Please check the box beside the person you want to remove first. You can select multiple people or use Select All.');
        return;
    }
    if (!(await confirmArchiveAction('Remove Approved Users', `Archive ${selected.length} selected user(s)? They will be kept for 7 days before their Firestore archive records expire.`, 'Archive Users'))) return;
    toggleLoading(true);
    const failures=[];
    try {
        for (const cb of selected) {
            try {
                const id=cb.dataset.id;
                const userSnap=await getDoc(doc(db, 'approvedUsers', id));
                if (!userSnap.exists()) continue;
                const archivedAt=new Date();
                const archivedDoc=doc(collection(db,'archivedUsers'));
                await setDoc(archivedDoc,{
                    ...userSnap.data(),
                    archivedAt:archivedAt.toISOString(),
                    expiresAt:Timestamp.fromMillis(archivedAt.getTime()+SEVEN_DAYS_MS),
                    originalApprovedId:id
                });
                await deleteDoc(doc(db,'approvedUsers',id));
            } catch (e) { failures.push(e.message); }
        }
        await loadApprovedUsers();
        if(failures.length) await showNotice('Some users could not be archived: '+failures.join('; '),'Partial Archive');
        else await showNotice(`${selected.length} user(s) archived. Note: their Firebase Authentication account is not disabled by this browser operation.`, 'Users Archived');
    } finally { toggleLoading(false); }
});

document.getElementById('selectAllApproved')?.addEventListener('change', e => {
    document.querySelectorAll('.approvedCheck').forEach(cb => cb.checked=e.target.checked);
});

// --- MULTI-SELECT HELPER ---
function createMultiSelect(selectedSections = []) {
    const container = document.createElement("div");
    container.className = "multi-select-container";
    const input = document.createElement("div");
    input.className = "multi-select-input";
    input.textContent = selectedSections.length ? selectedSections.join(", ") : "No Section";
    const dropdown = document.createElement("div");
    dropdown.className = "multi-select-dropdown";

    sections.forEach(sec => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = sec.name;
        if (selectedSections.includes(sec.name)) checkbox.checked = true;
        
        checkbox.addEventListener("change", () => {
            const all = Array.from(dropdown.querySelectorAll("input"));
            if (sec.name === "No Section" && checkbox.checked) {
                all.forEach(cb => { if (cb.value !== "No Section") cb.checked = false; });
            } else if (sec.name !== "No Section" && checkbox.checked) {
                const noSec = all.find(cb => cb.value === "No Section");
                if (noSec) noSec.checked = false;
            }
            const checked = all.filter(c => c.checked).map(c => c.value);
            input.textContent = checked.length ? checked.join(", ") : "No Section";
        });
        label.append(checkbox, " ", sec.name);
        dropdown.appendChild(label);
    });

    input.onclick = (e) => { 
        e.stopPropagation(); 
        document.querySelectorAll(".multi-select-container").forEach(c => { if (c !== container) c.classList.remove("active"); });
        container.classList.toggle("active"); 
    };
    container.append(input, dropdown);
    return container;
}const themeToggle = document.getElementById('themeToggle');

// 1. Immediate execution: Set theme and icon before the page finishes rendering
(function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
})();

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const html = document.documentElement;

    // 2. Set the initial icon based on the saved theme
    const currentTheme = html.getAttribute('data-theme');
    if (currentTheme === 'dark') {
        themeIcon.classList.remove('bi-moon');
        themeIcon.classList.add('bi-sun');
    } else {
        themeIcon.classList.remove('bi-sun');
        themeIcon.classList.add('bi-moon');
    }

    // 3. Handle the toggle click
    themeToggle.addEventListener('click', () => {
        const isDark = html.getAttribute('data-theme') === 'dark';
        
        if (isDark) {
            // Switching to Light
            html.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            themeIcon.classList.remove('bi-sun');
            themeIcon.classList.add('bi-moon');
        } else {
            // Switching to Dark
            html.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            themeIcon.classList.remove('bi-moon');
            themeIcon.classList.add('bi-sun');
        }
    });
});
// INITIAL LOAD
initializeDashboard();

// Cleanup for Cancel Buttons
cancelEditSections?.addEventListener("click", () => editSectionModal.classList.add("hidden"));
cancelDeleteSections?.addEventListener("click", () => deleteSectionModal.classList.add("hidden"));
cancelSectionBtn?.addEventListener("click", () => sectionModal.classList.add("hidden"));