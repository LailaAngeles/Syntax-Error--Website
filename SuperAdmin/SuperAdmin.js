import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// 1. Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 2. UI Selectors
const loginBtn = document.getElementById("loginBtn");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMsg = document.getElementById("errorMsg");
const popup = document.getElementById("systemPopup");

const userTable = document.getElementById("userTable");
const actionPopup = document.getElementById("action-popup");
const confirmBtn = document.getElementById("confirm-action-btn");
const selectAllPending = document.getElementById("selectAllPending");
const themeToggle = document.getElementById("theme-toggle");
const feedbackBox = document.getElementById("feedback-message");
const feedbackText = document.getElementById("feedback-text");
const cancelBtn = document.getElementById("cancel-btn");
let pendingAction = { type: null, ids: [], data: [] };

// 3. LOGIN LOGIC
if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
        try {
            await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
            const adminDoc = await getDoc(doc(db, "authorized_admins", "authorized_admins"));
            const data = adminDoc.data();

            if (data && (data.SuperAdmin === emailInput.value || data.superadmin === emailInput.value)) {
                window.location.href = "AdminDashboard.html";
            } else {
                await signOut(auth);
                document.getElementById('popup-message').innerText = "ACCESS DENIED: AUTHORIZATION LACKING.";
                popup.style.display = 'flex';
            }
        } catch (error) {
            errorMsg.innerText = "AUTHENTICATION FAILED";
            errorMsg.style.display = "block";
        }
    });
}

// 4. BULK & SELECT ALL LOGIC
if (selectAllPending) {
    selectAllPending.addEventListener("change", (e) => {
        document.querySelectorAll(".user-checkbox").forEach(cb => cb.checked = e.target.checked);
    });
}

function prepareAction(type) {
    const selected = document.querySelectorAll(".user-checkbox:checked");
    
    // Check if no items selected
    if (selected.length === 0) {
        feedbackBox.style.display = "block";
        feedbackBox.style.borderColor = "var(--risk-color)";
        feedbackText.innerText = "⚠️ Please select at least one user to perform this action.";
        document.getElementById("feedback-actions").style.display = "none";
        return;
    }

    // Prepare Confirmation UI
    pendingAction.type = type;
    pendingAction.ids = [];
    pendingAction.data = [];
    selected.forEach(cb => {
        pendingAction.ids.push(cb.dataset.id);
        pendingAction.data.push(JSON.parse(cb.dataset.user));
    });

    feedbackBox.style.display = "block";
    feedbackBox.style.borderColor = "var(--border)";
    feedbackText.innerText = `Are you sure you want to ${type} ${selected.length} user(s)?`;
    document.getElementById("feedback-actions").style.display = "flex";
}
document.getElementById("bulkApprove")?.addEventListener("click", () => prepareAction("approve"));
document.getElementById("bulkReject")?.addEventListener("click", () => prepareAction("reject"));
confirmBtn.addEventListener("click", async () => {
    try {for (let i = 0; i < pendingAction.ids.length; i++) {
            const id = pendingAction.ids[i];
            const user = pendingAction.data[i];
            if (pendingAction.type === "approve") {
                // Writing to this collection triggers your Cloud Function to create the Auth User
                await addDoc(collection(db, "approvedUsers"), { ...user, status: "approved" });
            }
            await deleteDoc(doc(db, "pendingUsers", id));
        }
       
        
        feedbackBox.style.display = "none"; 
        loadPendingUsers(); 
    } catch (e) { console.error("Action error:", e); }
});

// 5. LOAD PENDING USERS
async function loadPendingUsers() {
    if (!userTable) return;
    try {
        const q = query(collection(db, "pendingUsers"), where("status", "==", "pending"));
        const snap = await getDocs(q);
        
        userTable.innerHTML = "";

        // Check if no data found
        if (snap.empty) {
            userTable.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        <i class="bi bi-inbox"></i>
                        <p>No pending users found.</p>
                    </td>
                </tr>
            `;
            return;
        }

        snap.forEach((doc) => {
            const user = doc.data();
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><input type="checkbox" class="user-checkbox" data-id="${doc.id}" data-user='${JSON.stringify(user)}'></td>
                <td>${user.email || 'N/A'}</td>
                <td>${user.password || 'N/A'}</td>
                <td><span class="status-badge">Pending</span></td>
            `;
            userTable.appendChild(row);
        });
    } catch (e) { 
        console.error("Load error:", e); 
        userTable.innerHTML = `<tr><td colspan="4" class="empty-state">Error loading users.</td></tr>`;
    }
}

// 6. THEME PERSISTENCE
themeToggle?.addEventListener("click", () => {
    const html = document.documentElement;
    const newTheme = html.getAttribute("data-theme") === "light" ? "dark" : "light";
    html.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
});

document.addEventListener("DOMContentLoaded", () => {
    if (userTable) loadPendingUsers();
    const savedTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
});