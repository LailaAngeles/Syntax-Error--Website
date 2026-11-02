import { initializeApp, getApps, getApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, signOut } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
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
let pendingTeacher = null;
let creating = false;
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
// Step 2's list is live, so the new teacher is already there; just jump to it.
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
// Sections are assigned afterwards in Step 2, so new teachers start with "No Section".
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
    if(found) return showMessage(`This email already exists in ${found}.`);
  } catch(error) {
    return showMessage('Could not check existing records: ' + error.message);
  } finally {
    button.disabled=false;
  }
  showMessage('');
  pendingTeacher={teacherName,teacherEmail,pass};
  document.getElementById('teacherConfirmName').textContent=teacherName;
  document.getElementById('teacherConfirmEmail').textContent=teacherEmail;
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
  showMessage('Creating Firebase Authentication account and teacher record...',true);
  try {
    const uid=await provisionTeacher(teacher);
    showMessage('');
    form.reset();
    confirmModal.hidden=true;
    pendingTeacher=null;
    document.getElementById('teacherSuccessName').textContent=teacher.teacherName;
    document.getElementById('teacherSuccessEmail').textContent=teacher.teacherEmail;
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
    confirmYes.innerHTML='<i class="bi bi-check-circle"></i> Yes, Create Teacher';
    button.disabled=false;
  }
});
