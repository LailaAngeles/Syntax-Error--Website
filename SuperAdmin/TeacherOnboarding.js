import { initializeApp, getApps, getApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, doc, setDoc, updateDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, signOut } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { activeYear, isCurrentSection, watchSchoolYears } from '../MainMenu/school-years.js';
import { sectionHolders, heldByOthers, isSectionConflict } from './section-rules.js';
import { saveTeacherSections } from './section-assignment.js';
const config={apiKey:'AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc',authDomain:'syntaxerror-data.firebaseapp.com',projectId:'syntaxerror-data',storageBucket:'syntaxerror-data.firebasestorage.app',messagingSenderId:'513961059475',appId:'1:513961059475:web:fbf6f471357465dbaad966'};
const app=getApps().length?getApp():initializeApp(config);
const db=getFirestore(app);
const form=document.getElementById('createTeacherForm');
const message=document.getElementById('teacherCreateMessage');
const button=document.getElementById('createTeacherButton');
const nameInput=document.getElementById('teacherName');
const email=document.getElementById('teacherEmail');
const password=document.getElementById('teacherPassword');
const showMessage=(s,success=false)=>{message.textContent=s;message.style.color=success?'#16a34a':'#e34b4b';};
const emailRE=/^[a-z0-9._%+-]+@caloocan\.sti\.edu\.ph$/;
const confirmModal = document.getElementById('teacherConfirmModal');
const confirmYes = document.getElementById('teacherConfirmYes');
const confirmCancel = document.getElementById('teacherConfirmCancel');
const successModal = document.getElementById('teacherSuccessModal');
const sectionChoices = document.getElementById('teacherSectionChoices');
const sectionSummary = document.getElementById('teacherSectionSummary');
let pendingTeacher = null;
let creating = false;
// Sections on offer: this school year's, the same list as the Current teachers table.
const chosenSections = new Set();
let schoolYears = null;
let sectionSnapshot = null;
let teacherEntries = [];   // live approvedUsers records, to know which sections are already assigned
const sectionsText = names => names.length ? names.join(', ') : 'No Section';
// Message if any of these sections is already held by a teacher; '' when all are free.
function conflictMessage(names) {
  const holders = sectionHolders(teacherEntries);
  const clashes = names.filter(n => heldByOthers(holders, n).length);
  if (!clashes.length) return '';
  return clashes.map(n => `${n} is already assigned to ${heldByOthers(holders, n)[0].name}`).join('; ') + '. Choose a different section.';
}
function renderSectionSummary() {
  sectionSummary.replaceChildren();
  if (!chosenSections.size) {
    sectionSummary.textContent = 'None selected. The teacher starts with No Section and sees no students until one is assigned.';
    return;
  }
  sectionSummary.append(`Selected (${chosenSections.size}): `);
  [...chosenSections].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'teacher-section-chip';
    chip.textContent = name;
    sectionSummary.append(chip);
  });
}
function renderSectionChoices() {
  if (!schoolYears || !sectionSnapshot) return;
  const names = new Set();
  sectionSnapshot.forEach(d => { const name = d.data().name; if (name && isCurrentSection(d.data(), schoolYears)) names.add(name); });
  const holders = sectionHolders(teacherEntries);
  const takenBy = name => heldByOthers(holders, name);
  [...chosenSections].forEach(name => { if (!names.has(name) || takenBy(name).length) chosenSections.delete(name); });
  sectionChoices.replaceChildren();
  if (!names.size) {
    const note = document.createElement('p');
    note.className = 'teacher-sections-note';
    note.textContent = schoolYears.length && !activeYear(schoolYears)
      ? 'No school year is active. You can still add the teacher and assign sections after starting a school year.'
      : 'No sections yet. You can still add the teacher, or add a section first with Manage Sections.';
    sectionChoices.append(note);
  }
  [...names].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const owners = takenBy(name);
    const option = document.createElement('label');
    option.className = 'teacher-section-pick' + (owners.length ? ' is-taken' : '');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = name;
    box.checked = chosenSections.has(name);
    box.disabled = owners.length > 0;
    const span = document.createElement('span');
    span.textContent = owners.length ? `${name} (assigned to ${owners[0].name})` : name;
    option.append(box, span);
    sectionChoices.append(option);
  });
  renderSectionSummary();
}
[nameInput,email,password].forEach(input => input?.addEventListener('input', () => showMessage('')));
sectionChoices?.addEventListener('change', e => {
  if (!e.target.matches('input[type="checkbox"]')) return;
  e.target.checked ? chosenSections.add(e.target.value) : chosenSections.delete(e.target.value);
  renderSectionSummary();
});
watchSchoolYears(db, years => { schoolYears = years; renderSectionChoices(); });
onSnapshot(collection(db, 'sections'), snap => { sectionSnapshot = snap; renderSectionChoices(); },
  error => console.error('Sections listener error:', error));
onSnapshot(collection(db, 'approvedUsers'), snap => {
  teacherEntries = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  renderSectionChoices();
}, error => console.error('Teacher listener error:', error));
function closeConfirm() {
  if (creating) return;
  confirmModal.hidden = true;
  pendingTeacher = null;
  button.focus();
}
confirmCancel?.addEventListener('click', closeConfirm);
confirmModal?.addEventListener('click', e => { if(e.target===confirmModal)closeConfirm(); });
document.addEventListener('keydown', e => {
  if(e.key==='Escape' && confirmModal && !confirmModal.hidden)closeConfirm();
});
// The Current teachers list is live, so the new teacher is already there; just jump to it.
document.getElementById('teacherSuccessClose')?.addEventListener('click', () => {
  successModal.hidden = true;
  document.getElementById('teacher-section-assignment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
async function emailInUse(teacherEmail) {
  for (const name of ['approvedUsers','pendingUsers','archivedUsers']) {
    const snap = await getDocs(query(collection(db, name), where('email', '==', teacherEmail)));
    if (!snap.empty) return name;
  }
  return null;
}
// The teacher is created on a separate, in-memory Firebase app so the Super Admin's
// page session is never replaced. The record is written while signed in as the new
// teacher; if that write fails the new Auth user deletes itself, so nothing is left half-made.
// The record starts with "No Section"; assignSections then applies the sections chosen in the form.
async function provisionTeacher({teacherName,teacherEmail,pass}) {
  const provisioner = initializeApp(config, 'teacher-provisioning-' + Date.now());
  const provisionAuth = initializeAuth(provisioner, { persistence: inMemoryPersistence });
  try {
    const { user } = await createUserWithEmailAndPassword(provisionAuth, teacherEmail, pass);
    try {
      await setDoc(doc(getFirestore(provisioner), 'approvedUsers', user.uid), {
        email: teacherEmail,
        name: teacherName,
        role: 'teacher',
        section: ['No Section'],
        status: 'approved',
        isFirstLogin: true,
        hasAcceptedTerms: false,
        createdAt: serverTimestamp()
      });
    } catch (writeError) {
      await deleteUser(user).catch(rollbackError => {
        console.error('ROLLBACK FAILED: remove this Auth user manually:', user.uid, rollbackError);
        writeError.rollbackFailed = true;
      });
      throw writeError;
    }
    return user.uid;
  } finally {
    await signOut(provisionAuth).catch(() => {});
    await deleteApp(provisioner).catch(() => {});
  }
}
// The same save as Save in the Current teachers table (one transaction, refuses sections another teacher holds),
// so assignments are recorded per school year too.
async function assignSections(uid, names) {
  const year = activeYear(schoolYears || []);
  await saveTeacherSections(db, uid, names, { yearId: year?.id ?? null });
}
function describeError(error) {
  if (error?.rollbackFailed) return 'The teacher record could not be saved and the login account could not be removed. Delete it in Firebase Authentication before retrying.';
  switch (error?.code) {
    case 'auth/email-already-in-use': return 'This email already has a Firebase Authentication account.';
    case 'auth/weak-password': return 'The default password is too weak. Use at least 8 characters.';
    case 'auth/operation-not-allowed': return 'Email/password sign-in is disabled in Firebase Authentication.';
    case 'auth/network-request-failed': return 'Network error. Check the connection and try again.';
    case 'permission-denied': return 'Firestore rejected the teacher record. No account was created.';
    default: return 'Teacher account creation failed. No account was created.';
  }
}
form?.addEventListener('submit', async e => {
  e.preventDefault();
  if (creating) return;
  const teacherName=nameInput.value.trim().replace(/\s+/g,' ');
  const teacherEmail=email.value.trim().toLowerCase();
  const pass=password.value;
  if (teacherName.length<3 || teacherName.length>120) return showMessage('Enter the teacher\'s complete name.');
  if (!emailRE.test(teacherEmail))
    return showMessage('Use the teacher\'s official school email ending in @caloocan.sti.edu.ph.');
  if(pass.length<8 || pass.length>128) return showMessage('The default password must contain 8 to 128 characters.');
  button.disabled=true;
  showMessage('Checking existing records...',true);
  try {
    const found=await emailInUse(teacherEmail);
    if(found) return showMessage(found==='archivedUsers'?'This email belongs to an archived teacher. Restore them from Manage Users > View Archive.':'A teacher with this email already exists.');
  } catch(error) {
    return showMessage('Could not check existing records: ' + error.message);
  } finally {
    button.disabled=false;
  }
  // Refuse before any account is created if a chosen section was taken since it was picked.
  const taken = conflictMessage([...chosenSections]);
  if (taken) return showMessage(taken);
  showMessage('');
  pendingTeacher={teacherName,teacherEmail,pass,sections:[...chosenSections].sort((a,b)=>a.localeCompare(b))};
  document.getElementById('teacherConfirmName').textContent=teacherName;
  document.getElementById('teacherConfirmEmail').textContent=teacherEmail;
  document.getElementById('teacherConfirmSections').textContent=sectionsText(pendingTeacher.sections);
  confirmModal.hidden=false;
  confirmYes.focus();
});
confirmYes?.addEventListener('click', async () => {
  if (creating || !pendingTeacher) return;
  const teacher=pendingTeacher;
  creating=true;
  confirmYes.disabled=true;
  confirmCancel.disabled=true;
  button.disabled=true;
  confirmYes.textContent='Creating account...';
  showMessage('Creating the login and teacher record...',true);
  try {
    const uid=await provisionTeacher(teacher);
    // The account now exists. A failed assignment must not read as a failed account, or a retry would hit a duplicate.
    let assigned=true, assignProblem='';
    if(teacher.sections.length) {
      try { await assignSections(uid,teacher.sections); }
      catch(error) {
        assigned=false;
        if (isSectionConflict(error)) assignProblem = error.message;
        console.error('Section assignment failed:',{code:error?.code,message:error?.message});
      }
    }
    showMessage('');
    form.reset();
    chosenSections.clear();
    renderSectionChoices();
    confirmModal.hidden=true;
    pendingTeacher=null;
    document.getElementById('teacherSuccessName').textContent=teacher.teacherName;
    document.getElementById('teacherSuccessEmail').textContent=teacher.teacherEmail;
    document.getElementById('teacherSuccessSections').textContent=sectionsText(assigned?teacher.sections:[]);
    const note=document.getElementById('teacherSuccessNote');
    note.classList.toggle('teacher-note-warning',!assigned);
    note.textContent=!assigned
      ? (assignProblem
          ? `The account was created, but ${assignProblem} Assign other sections under Current teachers. Do not add this teacher again.`
          : `The account was created, but the sections could not be saved. Assign ${teacher.sections.join(', ')} under Current teachers. Do not add this teacher again.`)
      : teacher.sections.length ? 'Give the email and default password to the teacher privately.'
      : 'No section was assigned. Assign one under Current teachers so the teacher can see students.';
    console.info('Teacher created:', uid);
    successModal.hidden=false;
    document.getElementById('teacherSuccessClose').focus();
  } catch(error) {
    console.error('Teacher creation failed:', {code:error?.code,message:error?.message});
    showMessage(describeError(error));
    confirmModal.hidden=true;
    pendingTeacher=null;
  } finally {
    creating=false;
    confirmYes.disabled=false;
    confirmCancel.disabled=false;
    confirmYes.innerHTML='<i class="bi bi-check-circle"></i> Yes, Add Teacher';
    button.disabled=false;
  }
});
