import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
  getFirestore, collection, getDocs, deleteDoc, doc, setDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { 
  getAuth, createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";  
// CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
  authDomain: "syntaxerror-data.firebaseapp.com",
  projectId: "syntaxerror-data",
  storageBucket: "syntaxerror-data.firebasestorage.app",
  messagingSenderId: "513961059475",
  appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

// INIT
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ELEMENTS
const table = document.getElementById("userTable");
const approvedTable = document.getElementById("approvedTable");
const logoutBtn = document.getElementById("logoutBtn");
const sectionModal = document.getElementById("sectionModal");
const sectionInput = document.getElementById("sectionInput");
const saveSectionBtn = document.getElementById("saveSectionBtn");
const cancelSectionBtn = document.getElementById("cancelSectionBtn");
const addBtn = document.querySelector(".add-btn");
const loadingOverlay = document.getElementById("loading-overlay");

let usersData = [];

// --- LOADING HELPER ---
const toggleLoading = (show) => {
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? "flex" : "none";
    }
};

// =========================
// LOAD PENDING USERS
// =========================
async function loadUsers() {
    if (!table) return;
    const snapshot = await getDocs(collection(db, "pendingUsers"));
    table.innerHTML = "";
    usersData = [];

    if (snapshot.empty) {
        table.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:gray;">No pending users found.</td></tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        usersData.push({ id: docSnap.id, ...data });
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="checkbox" class="pendingCheck" data-id="${docSnap.id}"></td>
            <td>${data.email}</td>
            <td>${data.password}</td>
            <td>${data.status}</td>
        `;
        table.appendChild(row);
    });
}
window.showLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "flex";
    }
};

// 2. Hide the Popup (Stay button)
window.closeLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) {
        popup.style.display = "none";
    }
};

// 3. Execute Logout
window.logoutUser = async function() {
    toggleLoading(true);
    try {
        await signOut(auth);
        // Redirect to your login page (Update "index.html" if your login file name is different)
         window.location.href = '../Components/LogIn.html';
    } catch (error) {
        console.error("Logout Error:", error);
        alert("Sign out failed. Please try again.");
    } finally {
        toggleLoading(false);
    }
};
// =========================
// LOAD APPROVED USERS
// =========================
async function getSections() {
    const snapshot = await getDocs(collection(db, "sections"));
    let sections = [{ id: null, name: "No Section" }];
    snapshot.forEach(docSnap => {
        sections.push({ id: docSnap.id, name: docSnap.data().name });
    });
    return sections;
}

async function loadApprovedUsers() {
    if (!approvedTable) return;
    const snapshot = await getDocs(collection(db, "approvedUsers"));
    const sections = await getSections();
    approvedTable.innerHTML = "";

    if (snapshot.empty) {
        approvedTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:gray;">No approved users found.</td></tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="checkbox" class="approvedCheck" data-id="${docSnap.id}"></td>
            <td>${data.email}</td>
            <td>
                <div class="vertical-content">
                    ${sections.map(sec => `
                        <label>
                            <input type="checkbox" value="${sec.name}"
                            ${data.section?.includes(sec.name) ? "checked" : ""}>
                            ${sec.name}
                        </label>
                    `).join("")}
                </div>
            </td>
            <td><button class="saveBtn" data-id="${docSnap.id}">Save</button></td>
        `;
        approvedTable.appendChild(row);
    });
}

// =========================
// INITIALIZATION
// =========================
async function initializeDashboard() {
    toggleLoading(true);
    try {
        await Promise.all([loadUsers(), loadApprovedUsers()]);
    } catch (error) {
        console.error("Initialization Error:", error);
    } finally {
        toggleLoading(false);
    }
}

// =========================
// BULK APPROVE
// =========================
document.getElementById("bulkApprove")?.addEventListener("click", async () => {
    const ids = [...document.querySelectorAll(".pendingCheck:checked")].map(cb => cb.dataset.id);
    if (ids.length === 0) return alert("No users selected");

    const confirmed = await showConfirm("Approve selected users and create their login accounts?");
    if (!confirmed) return;

    toggleLoading(true);
    for (const id of ids) {
        const user = usersData.find(u => u.id === id);
        if (!user) continue;

        try {
            await createUserWithEmailAndPassword(auth, user.email, user.password);
            await setDoc(doc(db, "approvedUsers", id), {
                email: user.email,
                password: user.password,
                section: ["No Section"],
                status: "approved"
            });
            await deleteDoc(doc(db, "pendingUsers", id));
        } catch (error) {
            console.error(`Error approving ${user.email}:`, error.message);
            if (error.code === "auth/email-already-in-use") {
                await setDoc(doc(db, "approvedUsers", id), {
                    email: user.email,
                    password: user.password,
                    section: ["No Section"],
                    status: "approved"
                });
                await deleteDoc(doc(db, "pendingUsers", id));
            }
        }
    }
    await initializeDashboard();
    alert("Approval process complete.");
});

// =========================
// BULK REJECT
// =========================
document.getElementById("bulkReject")?.addEventListener("click", async () => {
    const ids = [...document.querySelectorAll(".pendingCheck:checked")].map(cb => cb.dataset.id);
    if (ids.length === 0) return alert("No users selected");

    const confirmed = await showConfirm("Reject selected users?");
    if (!confirmed) return;

    toggleLoading(true);
    for (const id of ids) {
        await deleteDoc(doc(db, "pendingUsers", id));
    }
    await initializeDashboard();
});

// =========================
// SECTION MANAGEMENT
// =========================
if (addBtn) addBtn.onclick = () => { sectionInput.value = ""; sectionModal.classList.remove("hidden"); };
if (cancelSectionBtn) cancelSectionBtn.onclick = () => sectionModal.classList.add("hidden");

if (saveSectionBtn) {
    saveSectionBtn.onclick = async () => {
        const name = sectionInput.value.trim();
        if (!name) return alert("Enter section name");
        
        toggleLoading(true);
        await setDoc(doc(collection(db, "sections")), { name });
        sectionModal.classList.add("hidden");
        await initializeDashboard();
    };
}

// =========================
// CONFIRM MODAL & UTILS
// =========================
function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirmModal");
        const text = document.getElementById("modalText");
        const yesBtn = document.getElementById("confirmYes");
        const noBtn = document.getElementById("confirmNo");

        if (!modal) return resolve(confirm(message));

        text.innerText = message;
        modal.classList.remove("hidden");
        yesBtn.onclick = () => { modal.classList.add("hidden"); resolve(true); };
        noBtn.onclick = () => { modal.classList.add("hidden"); resolve(false); };
    });
}

document.addEventListener("click", async (e) => {
    if (e.target.classList.contains("saveBtn")) {
        const id = e.target.dataset.id;
        const checkboxes = e.target.closest("tr").querySelectorAll("input[type='checkbox']");
        const selected = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
        
        toggleLoading(true);
        await updateDoc(doc(db, "approvedUsers", id), { section: selected });
        toggleLoading(false);
        alert("Section updated!");
    }
});

if (logoutBtn) logoutBtn.onclick = () => window.location.href = "../Components/LogIn.html";

// INITIAL LOAD
initializeDashboard();