import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
emailjs.init({ publicKey: "SZvtmcDCW3hy4qm5v" });

const emailInput = document.getElementById("email");
const pinInput = document.getElementById("pin");
const passBtn = document.getElementById("passBtn");
const pinBtn = document.getElementById("pinBtn");

const triggerError = (element) => {
    element.classList.add("error-input");
    setTimeout(() => element.classList.remove("error-input"), 2000);
};

let currentAuthEmail = "";

passBtn.addEventListener("click", async () => {
    const emailVal = emailInput.value.trim();
    
    if (!emailVal) {
        triggerError(emailInput);
        return;
    }

    const q = query(collection(db, "authorized_admins"), where("Email", "==", emailVal));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
        const userDoc = querySnapshot.docs[0];

        // Update Firestore with the new PIN
        await updateDoc(doc(db, "authorized_admins", userDoc.id), {
            pin: randomPin 
        });
try {

    const expirationTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await emailjs.send("service_ixe2e5j", "template_kvlen8d", {
        email: emailVal,
        passcode: randomPin,
        time: expirationTime 
    });

    currentAuthEmail = emailVal;
    document.getElementById("passwordStep").style.display = "none";
    document.getElementById("pinStep").style.display = "block";
} catch (error) {
    console.error("EmailJS Error:", error);
    alert("Failed to send email. Check the console.");
}
    } else {
        triggerError(emailInput);
        alert("Invalid User Identification");
    }
});

pinBtn.addEventListener("click", async () => {
    const pinVal = pinInput.value.trim();
    
    if (!pinVal) {
        triggerError(pinInput);
        return;
    }

    const q = query(
        collection(db, "authorized_admins"), 
        where("Email", "==", currentAuthEmail),
        where("pin", "==", pinVal)
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        window.location.href = "Dashboard.html";
    } else {
        triggerError(pinInput);
        alert("Invalid PIN");
    }
});