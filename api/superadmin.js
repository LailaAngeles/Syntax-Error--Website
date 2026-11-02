// Vercel Node.js serverless function. Deploy with the site, on the SAME origin.
// Private Firebase Admin credentials and EmailJS private key go in Vercel env vars.
import admin from 'firebase-admin';
import crypto from 'node:crypto';
const PROJECT='syntaxerror-data';
const SECRET=process.env.ADMIN_SESSION_SECRET;
const seconds=()=>Math.floor(Date.now()/1000);
const digest=v=>crypto.createHmac('sha256',SECRET).update(v).digest('hex');
function getAdmin(){
  if(!SECRET || SECRET.length<32) throw new Error('ADMIN_SESSION_SECRET is missing/too short');
  if(!admin.apps.length){
    const b64=process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if(!b64)throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is missing');
    const cred=JSON.parse(Buffer.from(b64,'base64').toString('utf8'));
    if(cred.project_id!==PROJECT)throw new Error('Service account project mismatch');
    admin.initializeApp({credential:admin.credential.cert(cred)});
  }
  return {db:admin.firestore(),auth:admin.auth()};
}
const json=(res,status,obj)=>res.status(status).json(obj);
function cookie(name,val,maxAge){return `${name}=${val}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;}
function cookieVal(req,name){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
const validEmail=e=>typeof e==='string' && /^[a-z0-9._%+-]+@caloocan\.sti\.edu\.ph$/.test(e) && e.length<=254;
async function isAdmin(db,email){const q=await db.collection('authorized_admins').where('Email','==',email).limit(1).get();return !q.empty;}
async function currentAdmin(req,db){
  const token=cookieVal(req,'se_admin_session');if(!/^[a-f0-9]{64}$/.test(token))return null;
  const d=await db.collection('superadminSessions').doc(digest(token)).get();
  if(!d.exists || d.data().expiresAt?.toMillis()<=Date.now())return null;
  if(!await isAdmin(db,d.data().email))return null;
  return {email:d.data().email,ref:d.ref};
}
async function sendOTP(email,pin){
  const {EMAILJS_PUBLIC_KEY,EMAILJS_PRIVATE_KEY,EMAILJS_SERVICE_ID,EMAILJS_TEMPLATE_ID}=process.env;
  if(!EMAILJS_PUBLIC_KEY||!EMAILJS_PRIVATE_KEY||!EMAILJS_SERVICE_ID||!EMAILJS_TEMPLATE_ID)throw new Error('EmailJS server environment configuration missing');
  const r=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      service_id:EMAILJS_SERVICE_ID,template_id:EMAILJS_TEMPLATE_ID,
      user_id:EMAILJS_PUBLIC_KEY,accessToken:EMAILJS_PRIVATE_KEY,
      template_params:{email,passcode:pin,time:new Date(Date.now()+15*60000).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'})}
    })
  });
  if(!r.ok)throw new Error('EmailJS send failed: HTTP '+r.status);
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    const {db,auth}=getAdmin();
    const {action}=req.body||{};
    if(action==='requestOtp'){
      const email=String(req.body.email||'').trim().toLowerCase();
      if(!validEmail(email))return json(res,400,{error:'Enter a valid STI email.'});
      if(!await isAdmin(db,email))return json(res,403,{error:'Email is not authorized for SuperAdmin.'});
      const ref=db.collection('superadminOtpChallenges').doc(digest(email));
      const existing=await ref.get();
      if(existing.exists && existing.data().nextAllowedAt?.toMillis()>Date.now())return json(res,429,{error:'Please wait before requesting another code.'});
      const pin=String(crypto.randomInt(100000,1000000));
      await ref.set({email,pinHash:digest(email+':'+pin),expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+15*60000),nextAllowedAt:admin.firestore.Timestamp.fromMillis(Date.now()+60000),attempts:0});
      try{await sendOTP(email,pin);}catch(e){await ref.delete();throw e;}
      return json(res,200,{success:true});
    }
    if(action==='verifyOtp'){
      const email=String(req.body.email||'').trim().toLowerCase();const pin=String(req.body.pin||'').trim();
      if(!validEmail(email)||!/^[0-9]{6}$/.test(pin))return json(res,400,{error:'Invalid email or 6-digit code.'});
      if(!await isAdmin(db,email))return json(res,403,{error:'Admin not authorized.'});
      const ref=db.collection('superadminOtpChallenges').doc(digest(email));
      const valid=await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);if(!snap.exists)return false;
        const d=snap.data();if(d.expiresAt.toMillis()<Date.now()||d.attempts>=5)return false;
        const a=Buffer.from(d.pinHash,'hex'),b=Buffer.from(digest(email+':'+pin),'hex');
        if(!crypto.timingSafeEqual(a,b)){tx.update(ref,{attempts:admin.firestore.FieldValue.increment(1)});return false;}
        tx.delete(ref);return true;
      });
      if(!valid)return json(res,401,{error:'Incorrect, expired, or locked verification code.'});
      const token=crypto.randomBytes(32).toString('hex');
      await db.collection('superadminSessions').doc(digest(token)).set({email,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+30*60000)});
      res.setHeader('Set-Cookie',cookie('se_admin_session',token,1800));
      return json(res,200,{success:true});
    }
    if(action==='logout'){
      const token=cookieVal(req,'se_admin_session');
      if(/^[a-f0-9]{64}$/.test(token))await db.collection('superadminSessions').doc(digest(token)).delete();
      res.setHeader('Set-Cookie',cookie('se_admin_session','',0));
      return json(res,200,{success:true});
    }
    const person=await currentAdmin(req,db);
    if(!person)return json(res,401,{error:'SuperAdmin session expired. Sign in using email and OTP.'});
    if(action==='session')return json(res,200,{success:true,email:person.email});
    if(action!=='createTeacher')return json(res,400,{error:'Unknown action'});
    const email=String(req.body.email||'').trim().toLowerCase();
    const password=String(req.body.password||'');
    const section=String(req.body.section||'').trim();
    if(!validEmail(email))return json(res,400,{error:'Teacher email must end in @caloocan.sti.edu.ph.'});
    if(password.length<8||password.length>128)return json(res,400,{error:'Temporary password must be 8–128 characters.'});
    if(!section||section==='No Section'||section.length>128)return json(res,400,{error:'Choose an existing section.'});
    const sectionSnap=await db.collection('sections').where('name','==',section).limit(1).get();
    if(sectionSnap.empty)return json(res,400,{error:'Selected section no longer exists.'});
    // Do not silently approve an existing Auth user or create an unmatched Firestore record.
    try{await auth.getUserByEmail(email);return json(res,409,{error:'This email already exists in Firebase Authentication. Check existing records.'});}
    catch(e){if(e.code!=='auth/user-not-found')throw e;}
    const existing=await db.collection('approvedUsers').where('email','==',email).limit(1).get();
    if(!existing.empty)return json(res,409,{error:'This email already exists in approvedUsers.'});
    let user;
    try{
      user=await auth.createUser({email,password,emailVerified:false,disabled:false});
      await db.collection('approvedUsers').doc(user.uid).create({email,section:[section],status:'approved',createdAt:admin.firestore.FieldValue.serverTimestamp(),approvedAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:person.email});
    }catch(e){
      if(user){try{await auth.deleteUser(user.uid);}catch(cleanup){console.error('ROLLBACK FAILED: manual reconciliation required for UID:',user.uid,cleanup);return json(res,500,{error:'Firestore failed after account creation. Contact administrator; check Authentication before retrying.'});}}
      if(e.code==='auth/email-already-exists'||e.code==='already-exists')return json(res,409,{error:'Account already exists.'});
      throw e;
    }
    return json(res,200,{success:true,uid:user.uid,email});
  }catch(e){console.error('SuperAdmin API error:',e);return json(res,500,{error:'Server configuration or Firebase operation failed. Check Vercel function logs.'});}
}
