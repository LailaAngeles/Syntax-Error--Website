import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginBtn = document.getElementById("loginBtn");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMsg = document.getElementById("errorMsg");
const popup = document.getElementById("systemPopup");

loginBtn.addEventListener("click", async () => {
    try {
        await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
        const adminDoc = await getDoc(doc(db, "authorized_admins", "authorized_admins"));
        const data = adminDoc.data();

        if (data && (data.SuperAdmin === emailInput.value || data.superadmin === emailInput.value)) {
            window.location.href = "AdminDashboard.html";
        } else {
            await auth.signOut();
            document.getElementById('popup-message').innerText = "ACCESS DENIED: AUTHORIZATION LACKING.";
            popup.style.display = 'flex';
        }
    } catch (error) {
        errorMsg.innerText = "AUTHENTICATION FAILED";
        errorMsg.style.display = "block";
    }
});