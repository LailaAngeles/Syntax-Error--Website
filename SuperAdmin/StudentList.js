import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
// Fixed: Added getAuth to the imports
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ----------------------------
// CONFIG & INITIALIZATION
// ----------------------------
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
// Fixed: Initialized the auth instance
const auth = getAuth(app); 

let allStudents = [];
let difficultyChart;

const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if(loader) loader.style.display = show ? "flex" : "none";
};

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
         window.location.href = '../Components/LogIn.html';
    } catch (error) {
        console.error("Logout Error:", error);
        alert("Sign out failed. Please try again.");
    } finally {
        toggleLoading(false);
    }
};

// ----------------------------
// 1. DATA FETCHING
// ----------------------------
async function fetchAllDatabaseContent() {
    toggleLoading(true); 
    allStudents = [];
    const sectionSelect = document.getElementById("section-select");
    
    if (sectionSelect) sectionSelect.innerHTML = '<option value="">-- All Sections --</option>';

    try {
        const sectionsSnap = await getDocs(collection(db, "sections"));
        
        const fetchPromises = sectionsSnap.docs.map(async (sectionDoc) => {
            const sectionName = sectionDoc.data().name || sectionDoc.id;
            
            if (sectionSelect) {
                const opt = document.createElement("option");
                opt.value = sectionName;
                opt.textContent = sectionName;
                sectionSelect.appendChild(opt);
            }

            const classSnap = await getDocs(collection(db, "sections", sectionDoc.id, "classList"));
            classSnap.forEach(studentDoc => {
                allStudents.push({
                    ...studentDoc.data(),
                    sectionName: sectionName,
                    firebaseId: studentDoc.id
                });
            });
        });

        await Promise.all(fetchPromises);
        renderTable(""); 
        
    } catch (error) {
        console.error("Database Fetch Error:", error);
    } finally {
        toggleLoading(false); 
    }
}

// ----------------------------
// 2. RENDERING LOGIC (Updated with Empty State UI)
// ----------------------------
function renderTable(filterSection) {
    const tableBody = document.getElementById("students-table");
    const searchTerm = document.getElementById("search-student")?.value.toLowerCase() || "";

    if (!tableBody) return;

    // 1. Filter the data
    let filtered = allStudents.filter(s => {
        const matchesSection = !filterSection || s.sectionName === filterSection;
        const matchesSearch = !searchTerm || 
                              (s.name && s.name.toLowerCase().includes(searchTerm)) || 
                              (s.id && s.id.toString().includes(searchTerm));
        return matchesSection && matchesSearch;
    });

    // 2. Sort alphabetically by name
    filtered.sort((a, b) => {
        const nameA = (a.name || "").toLowerCase();
        const nameB = (b.name || "").toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // Update Totals
    document.getElementById("card-total-students").textContent = filtered.length;
    let avg = filtered.length > 0 ? Math.round(filtered.reduce((acc, s) => acc + (s.progress || 0), 0) / filtered.length) : 0;
    document.getElementById("average-score").textContent = avg + "%";

    // 3. UI logic: Handle Empty State vs Table rows
    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div style="font-size: 2rem; margin-bottom: 10px;"><i class="bi bi-inbox"></i></div>
                    <h4>No Students Found</h4>
                    <p>Try adjusting your search or section filter.</p>
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = filtered.map(s => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px; font-weight: 600;">${s.id || "---"}</td>
                <td style="padding: 15px;">${s.name || "Unknown"}</td>
                <td style="padding: 15px;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 20px;">${s.sectionName}</span></td>
                <td style="padding: 15px;">
                    <div style="width: 100px; background: #e2e8f0; height: 6px; border-radius: 10px;">
                        <div style="width: ${s.progress || 0}%; background: #3b82f6; height: 100%; border-radius: 10px;"></div>
                    </div>
                    <small style="color: #64748b;">${s.progress || 0}%</small>
                </td>
                <td style="padding: 15px;">
                    <button onclick="viewAnalysis('${s.firebaseId}')" style="background: #3b82f6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer;">
                        Details
                    </button>
                </td>
            </tr>
        `).join("");
    }
}
// ----------------------------
// 3. ANALYSIS & CHART
// ----------------------------
window.viewAnalysis = function(firebaseId) {
    const student = allStudents.find(s => s.firebaseId === firebaseId);
    if (!student) return;

    const analysisSec = document.getElementById("analysis-section");
    if (analysisSec) analysisSec.style.display = "grid";

    document.getElementById("student-details-content").innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px;">
            <div><label style="color:#64748b; font-size:0.8rem; text-transform:uppercase; font-weight:bold;">Full Name</label><div style="font-weight:600;">${student.name}</div></div>
            <div><label style="color:#64748b; font-size:0.8rem; text-transform:uppercase; font-weight:bold;">Student Number</label><div style="font-weight:600;">${student.id}</div></div>
            <div><label style="color:#64748b; font-size:0.8rem; text-transform:uppercase; font-weight:bold;">Section</label><div style="font-weight:600;">${student.sectionName}</div></div>
            <div><label style="color:#64748b; font-size:0.8rem; text-transform:uppercase; font-weight:bold;">Idle Time</label><div style="font-weight:600;">${student.idleTime || "0m"}</div></div>
        </div>
    `;

    renderChart(student.difficulty || [0, 0, 0, 0, 0]);
    if (analysisSec) analysisSec.scrollIntoView({ behavior: 'smooth' });
};

function renderChart(data) {
    const canvas = document.getElementById("difficultyChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (difficultyChart) difficultyChart.destroy();
    
    difficultyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['L1', 'L2', 'L3', 'L4', 'L5'],
            datasets: [{
                label: 'Difficulty Score',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// ----------------------------
// 4. INITIALIZE & EVENTS
// ----------------------------
fetchAllDatabaseContent();

document.getElementById("section-select")?.addEventListener("change", (e) => renderTable(e.target.value));
document.getElementById("search-student")?.addEventListener("input", () => {
    const sel = document.getElementById("section-select").value;
    renderTable(sel);
});

// Fixed: Added event listener to trigger the logout popup
document.getElementById("logout-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.showLogoutPopup();
});