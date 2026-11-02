// Deploy with Firebase Functions v2. No teacher password is stored in Firestore.
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
admin.initializeApp();
const db=admin.firestore();
const emailRE=/^[a-z0-9._%+-]+@caloocan\.sti\.edu\.ph$/;
exports.createTeacherBySuperAdmin=onCall({region:'us-central1',maxInstances:10},async request=>{
  let stage='request-validation';
  try {
  const v=request.data||{};
  const adminEmail=String(v.adminEmail||'').trim().toLowerCase();
  const otp=String(v.otp||'').trim();
  const email=String(v.email||'').trim().toLowerCase();
  const password=v.password;
  const section=String(v.section||'').trim();
  if(!emailRE.test(email)||typeof password!=='string'||password.length<8||password.length>128||!section||otp.length!==6){
    throw new HttpsError('invalid-argument','Check teacher email, password, section, and OTP.');
  }
  if(!adminEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))throw new HttpsError('permission-denied','Invalid SuperAdmin email.');
  // Limit guesses per administrator email. Recommending Firebase App Check and network-level rate limiting too.
  stage='otp-rate-limit';
  const limitRef=db.collection('_superadminOtpRateLimit').doc(Buffer.from(adminEmail).toString('hex'));
  const now=Date.now();
  await db.runTransaction(async tx=>{
    const snap=await tx.get(limitRef);const entry=snap.data()||{};
    const attempts=now-(entry.startedAt||0)<15*60*1000?(entry.attempts||0):0;
    if(attempts>=5)throw new HttpsError('resource-exhausted','Too many attempts. Try again later.');
    tx.set(limitRef,{startedAt:attempts?entry.startedAt:now,attempts:attempts+1},{merge:true});
  });
  stage='admin-otp-check';
  const admins=await db.collection('authorized_admins').where('Email','==',adminEmail).limit(1).get();
  if(admins.empty)throw new HttpsError('permission-denied','SuperAdmin identity is not authorized.');
  const record=admins.docs[0].data();
  const issued=record.pinIssuedAt?.toMillis?.();
  if(!issued||now-issued>15*60*1000||issued>now+60000||String(record.pin)!==otp)
    throw new HttpsError('permission-denied','OTP is invalid or expired. Please sign in again.');
  stage='section-check';
  const sections=await db.collection('sections').where('name','==',section).limit(1).get();
  if(sections.empty)throw new HttpsError('invalid-argument','This section does not exist.');
  stage='duplicate-check';
  const existing=await db.collection('approvedUsers').where('email','==',email).limit(1).get();
  if(!existing.empty)throw new HttpsError('already-exists','The teacher is already approved.');
  const archived=await db.collection('archivedUsers').where('email','==',email).limit(1).get();
  if(!archived.empty)throw new HttpsError('already-exists','The teacher is archived. Restore the existing record.');
  const pending=await db.collection('pendingUsers').where('email','==',email).limit(1).get();
  if(!pending.empty)throw new HttpsError('already-exists','The teacher has a pending record. Resolve it first.');
  stage='firebase-auth-create';
  let user;
  try{user=await admin.auth().createUser({email,password,emailVerified:false,disabled:false});}
  catch(e){console.error('[createTeacherBySuperAdmin] Firebase Auth creation failed', {code:e.code,message:e.message});if(e.code==='auth/email-already-exists')throw new HttpsError('already-exists','This email already exists in Firebase Authentication.');throw new HttpsError('internal','Firebase Authentication could not create the teacher. Check Cloud Function logs.');}
  stage='approved-users-write';
  try{
    await db.collection('approvedUsers').doc(user.uid).set({email,section:[section],status:'approved',createdAt:admin.firestore.FieldValue.serverTimestamp(),approvedAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:adminEmail});
  }catch(e){console.error('[createTeacherBySuperAdmin] approvedUsers write failed', {code:e.code,message:e.message});await admin.auth().deleteUser(user.uid).catch(err=>console.error('Rollback failed',err));throw new HttpsError('internal','The teacher record could not be saved. Check Cloud Function logs.');}
  console.info('[createTeacherBySuperAdmin] Authentication + approvedUsers created', {uid:user.uid,section});
  return {success:true,uid:user.uid};
  } catch (error) {
    console.error('[createTeacherBySuperAdmin] failed', {stage,code:error.code||'unknown',message:error.message,stack:error.stack});
    if(error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Teacher creation failed during '+stage+'. Check Firebase Functions logs.');
  }
});
