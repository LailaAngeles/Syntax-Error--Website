import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, query, where, writeBatch, doc, updateDoc, deleteDoc, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// 1. FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const mockStudent = {
    id: "2024-0512",
    name: "Alex Rivera",
    section: "BSCS-201",
    progress: 65,
    gameStats: [
        { level: "Variables", wrongs: 1, time: 95 },
        { level: "If-Else",   wrongs: 8, time: 420 },
        { level: "Loops",     wrongs: 4, time: 210 },
        { level: "Functions", wrongs: 0, time: 0 },
        { level: "Firestore", wrongs: 0, time: 0 }
    ],
    difficulty: [1, 9, 5, 0, 0] 
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global Variables
let allStudents = [];
let currentUserSection = []; 
let sectionDocMapping = {}; 
let difficultyChart;
let sectionPieChartInstance = null;
let overallColumnChartInstance = null;
function getSubjectContentWrongs(studentDoc) {
    const subjectContent = studentDoc["Subject Content"] || studentDoc.subjectContent;
    const categoryAffected = {};

    if (!subjectContent || typeof subjectContent !== "object") {
        return categoryAffected;
    }

    // Iterate dynamically through all top-level categories in "Subject Content"
    for (const categoryKey in subjectContent) {
        const categoryData = subjectContent[categoryKey];
        if (typeof categoryData !== "object" || categoryData === null) continue;

        let hasError = false;

        // Recursive check to see if any leaf node has wrongAttempts > 0
        function checkForErrors(obj) {
            for (const key in obj) {
                const val = obj[key];
                if (typeof val === "object" && val !== null) {
                    if ("wrongAttempts" in val) {
                        if (Number(val.wrongAttempts || 0) > 0) {
                            hasError = true;
                        }
                    } else {
                        checkForErrors(val);
                    }
                }
            }
        }

        checkForErrors(categoryData);
        
        // Mark 1 if student faced an issue in this category, 0 otherwise
        categoryAffected[categoryKey] = hasError ? 1 : 0;
    }

    return categoryAffected;
}
function renderDashboardCharts(sectionStudents) {
    const conceptMapSection = {};
    const conceptMapOverall = {};
    updateRecommendations(conceptMapOverall, allStudents.length);
    // 1. Count affected students in selected section
    sectionStudents.forEach(s => {
        const affectedCategories = getSubjectContentWrongs(s);
        for (const [concept, count] of Object.entries(affectedCategories)) {
            conceptMapSection[concept] = (conceptMapSection[concept] || 0) + count;
        }
    });

    // 2. Count affected students across ALL sections
    allStudents.forEach(s => {
        const affectedCategories = getSubjectContentWrongs(s);
        for (const [concept, count] of Object.entries(affectedCategories)) {
            conceptMapOverall[concept] = (conceptMapOverall[concept] || 0) + count;
        }
    });

    let sectionLabels = Object.keys(conceptMapSection);
    let sectionValues = Object.values(conceptMapSection);

    if (sectionLabels.length === 0) {
        sectionLabels = ["No Data Available"];
        sectionValues = [0];
    }

    let overallLabels = Object.keys(conceptMapOverall);
    let overallValues = Object.values(conceptMapOverall);

    if (overallLabels.length === 0) {
        overallLabels = ["No Data Available"];
        overallValues = [0];
    }

    const colorPalette = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

    // 3. Render Section Pie Chart
    const pieCanvas = document.getElementById("sectionPieChart");
    if (pieCanvas) {
        const pieCtx = pieCanvas.getContext("2d");
        if (sectionPieChartInstance) sectionPieChartInstance.destroy();

        sectionPieChartInstance = new Chart(pieCtx, {
            type: 'pie',
            data: {
                labels: sectionLabels.map(l => l.toUpperCase()),
                datasets: [{
                    data: sectionValues,
                    backgroundColor: colorPalette.slice(0, sectionLabels.length)
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${context.raw} Student(s) Struggling`;
                            }
                        }
                    }
                }
            }
        });
    }

    // 4. Render Overall Column Chart
    const colCanvas = document.getElementById("overallColumnChart");
    if (colCanvas) {
        const colCtx = colCanvas.getContext("2d");
        if (overallColumnChartInstance) overallColumnChartInstance.destroy();

        overallColumnChartInstance = new Chart(colCtx, {
            type: 'bar',
            data: {
                labels: overallLabels.map(l => l.toUpperCase()),
                datasets: [{
                    label: 'Students Facing Issues',
                    data: overallValues,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { 
                        beginAtZero: true, 
                        ticks: { stepSize: 1 }, 
                        title: { display: true, text: 'Number of Students' } 
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}
// COURSE OUTLINE
const COURSE_OUTLINE = [
    { level: 1, module: "C# Basics", lesson: "Variables & Data Types" },
    { level: 2, module: "Control Flow", lesson: "If-Else Statements" },
    { level: 3, module: "Loops", lesson: "For & While Loops" },
    { level: 4, module: "Functions", lesson: "Methods & Parameters" },
    { level: 5, module: "Integration", lesson: "Firestore Integration" }
];

function formatBirthdayToPassword(dateStr) {
    if (!dateStr || dateStr === "No Birthday") return "";
    return String(dateStr).replace(/-/g, "");
}

// UI Helpers
const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if(loader) loader.style.display = show ? "flex" : "none";
};

function renderStudentInsights(students) {
    const container = document.getElementById("student-analysis");
    if (!container) return;

    let struggling = students.filter(s => (s.progress || 0) < 50);

    container.innerHTML = struggling.map(s => {
        let weakestIndex = (s.difficulty || []).indexOf(Math.max(...(s.difficulty || [0])));
        let lesson = COURSE_OUTLINE[weakestIndex];

        return `
            <div class="lesson-alert">
                <strong>${s.name}</strong><br>
                Struggling with: ${lesson.module} → ${lesson.lesson}
            </div>
        `;
    }).join("") || "<p>All students performing well.</p>";
}

// 2. DATA INITIALIZATION
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../Login/Login.html";
        return;
    }
    toggleLoading(true);
    await getUserData(user);
    await fetchClassList();
    toggleLoading(false);
});

async function getUserData(user) {
    const select = document.getElementById("section-select");
    if (select) select.innerHTML = '<option value="">-- All My Sections --</option>';
    
    sectionDocMapping = {};
    currentUserSection = [];

    try {
        const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
        const userSnap = await getDocs(q);
        userSnap.forEach(doc => {
            currentUserSection = doc.data().section || [];
        });

        if(document.getElementById("user-section")) {
            document.getElementById("user-section").textContent = currentUserSection.join(", ");
        }

        const sectionSnap = await getDocs(collection(db, "sections"));
        sectionSnap.forEach(d => {
            const sectionName = d.data().name;
            sectionDocMapping[sectionName] = d.id;
            
            if (currentUserSection.includes(sectionName) && select) {
                const opt = document.createElement("option");
                opt.value = sectionName;
                opt.textContent = sectionName;
                select.appendChild(opt);
            }
        });

    } catch (error) {
        console.error("Error fetching user data:", error);
    }
}

async function fetchClassList() {
    allStudents = [];
    for (const sectionName of currentUserSection) {
        const docId = sectionDocMapping[sectionName];
        if (!docId) continue;
        
        const classRef = collection(db, "sections", docId, "classList");
        const snap = await getDocs(classRef);
        
        snap.forEach(sDoc => {
            allStudents.push({ 
                ...sDoc.data(), 
                section: sectionName, 
                parentDocId: docId 
            });
        });
    }
    loadStudents("");
}

// 3. TABLE LOADING & STAT UPDATES
function loadStudents(section) {
    const table = document.getElementById("students-table");
    const emptyState = document.getElementById("empty-state");
    const searchInput = document.getElementById("search-student");
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    if(table) table.innerHTML = "";

    let filtered = allStudents.filter(s => {
        const matchesSection = (section === "" || s.section === section);
        const matchesSearch = !searchTerm || 
                              (s.name && s.name.toLowerCase().includes(searchTerm)) || 
                              (s.id && s.id.toString().toLowerCase().includes(searchTerm));
        return matchesSection && matchesSearch;
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    // Update Card Stats
    const totalStudentsEl = document.getElementById("card-total-students");
    if (totalStudentsEl) totalStudentsEl.textContent = filtered.length;
    
    // Calculate and display online students
    const onlineCount = filtered.filter(s => s.isOnline === true).length;
    const onlineCountEl = document.getElementById("online-count");
    if (onlineCountEl) onlineCountEl.textContent = onlineCount;

    let avgProg = filtered.length > 0 
        ? Math.round(filtered.reduce((acc, s) => acc + (s.progress || 0), 0) / filtered.length) 
        : 0;
    
    const avgScoreEl = document.getElementById("average-score");
    if (avgScoreEl) avgScoreEl.textContent = avgProg + "%";

    if (filtered.length === 0) {
        if(emptyState) emptyState.style.display = "block";
        return;
    } else {
        if(emptyState) emptyState.style.display = "none";
    }
    renderDashboardCharts(filtered);
    if(table) {
        table.innerHTML = filtered.map(s => {
            const isOnline = s.isOnline === true || s.isOnline === "true";

            const statusBadge = isOnline 
                ? `<span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
                     <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%;"></span> Online
                   </span>`
                : `<span style="background: #f1f5f9; color: #64748b; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
                     <span style="width: 8px; height: 8px; background: #94a3b8; border-radius: 50%;"></span> Offline
                   </span>`;

            return `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px;"><strong>${s.id}</strong></td>
                <td style="padding: 15px;">${s.name}</td>
                <td style="padding: 15px;">
                    <div style="width:100px; background:#e5e7eb; border-radius:10px; height:8px; margin-bottom:4px;">
                        <div style="width:${s.progress || 0}%; background:#3b82f6; height:100%; border-radius:10px;"></div>
                    </div>
                    <small style="color:#64748b;">${s.progress || 0}% Complete</small>
                </td>
                <td style="padding: 15px;">${statusBadge}</td>
                <td style="padding: 15px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="viewStudent('${s.id}')" 
                                style="background: #3b82f6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 14px;">
                            <i class="bi bi-eye"></i> Details
                        </button>
                        <button onclick="editStudent('${s.id}')" 
                                style="background:#f59e0b; color:white; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; display: flex; align-items: center; height: 35px;">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button onclick="archiveStudent('${s.id}')" 
                                style="background:#6b7280; color:white; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; display: flex; align-items: center; height: 35px;">
                            <i class="bi bi-archive"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join("");
    }
}

// 4. EDIT & ARCHIVE LOGIC
window.editStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const idInput = document.getElementById("edit-id-input");
    const nameInput = document.getElementById("edit-name-input");
    const bdayInput = document.getElementById("edit-birthday-input");
    const saveBtn = document.getElementById("save-edit-btn");
    
    idInput.value = student.id;
    nameInput.value = student.name;
    bdayInput.value = student.birthday || "";
    
    document.getElementById("edit-modal").style.display = "flex";
    saveBtn.disabled = false;
    saveBtn.innerText = "Save Changes";

    saveBtn.onclick = async () => {
        const newId = idInput.value.trim();
        const newName = nameInput.value.trim();
        const newBday = bdayInput.value;
        const newPassword = formatBirthdayToPassword(newBday);

        if (!newId || !newName) {
            alert("Student Number and Name are required!");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        toggleLoading(true);

        try {
            const oldRef = doc(db, "sections", student.parentDocId, "classList", student.id);
            
            if (newId !== student.id) {
                const newRef = doc(db, "sections", student.parentDocId, "classList", newId);
                await setDoc(newRef, {
                    ...student,
                    id: newId,
                    name: newName,
                    birthday: newBday,
                    password: newPassword
                });
                await deleteDoc(oldRef);
            } else {
                await updateDoc(oldRef, { 
                    name: newName,
                    birthday: newBday,
                    password: newPassword
                });
            }
            
            closeEditModal();
            await fetchClassList(); 
            alert("Student record updated!");
        } catch (error) {
            console.error("Update error:", error);
            alert("Failed to update record.");
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            toggleLoading(false);
        }
    };
};

window.closeEditModal = function() {
    document.getElementById("edit-modal").style.display = "none";
};

window.archiveStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const confirmModal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = `Archive ${student.name}?`;
    document.getElementById("confirm-message").textContent = `This student will be moved to the archive and removed from ${student.section}.`;
    confirmModal.style.display = "flex";

    document.getElementById("confirm-action-btn").onclick = async () => {
        const actionBtn = document.getElementById("confirm-action-btn");
        actionBtn.disabled = true;
        actionBtn.innerText = "Archiving...";
        
        await proceedWithArchive(student);
        
        actionBtn.disabled = false;
        actionBtn.innerText = "Confirm Archive";
        closeConfirmModal();
    };
};

async function proceedWithArchive(student) {
    toggleLoading(true);
    try {
        const archiveRef = doc(db, "archivedStudents", student.id);
        
        await setDoc(archiveRef, {
            ...student,
            archivedAt: serverTimestamp(),
            status: "archived"
        });

        const originalRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        await deleteDoc(originalRef);

        alert(`${student.name} has been moved to the archive.`);
        await fetchClassList(); 
        
    } catch (error) {
        console.error("Archive Error:", error);
        alert("Failed to archive student. Please try again.");
    } finally {
        toggleLoading(false);
    }
}

window.closeConfirmModal = () => document.getElementById("confirm-modal").style.display = "none";
window.closeArchiveModal = () => document.getElementById("custom-archive-modal").style.display = "none";

// 5. INDIVIDUAL STUDENT VIEW 
let gapChart; 
let modalDifficultyChart;

function renderConceptBreakdown(studentData) {
    const container = document.getElementById("modal-concept-breakdown");
    if (!container) return;

    container.innerHTML = "";

    const subjectContent = studentData["Subject Content"] || studentData.subjectContent;

    if (!subjectContent) {
        container.innerHTML = `<p style="font-size: 0.85rem; color: #94a3b8;">No detailed topic attempt data found for this student.</p>`;
        return;
    }

    const categories = [];

    for (const catKey in subjectContent) {
        const categoryData = subjectContent[catKey];
        if (typeof categoryData !== "object" || categoryData === null) continue;

        let categoryTotalWrongs = 0;
        const subTopics = [];

        function extractLeafTopics(obj, prefix = "") {
            for (const key in obj) {
                const val = obj[key];
                if (typeof val === "object" && val !== null && !(val instanceof Date)) {
                    if ("wrongAttempts" in val) {
                        const wrongs = val.wrongAttempts || 0;
                        if (wrongs > 0) {
                            categoryTotalWrongs += wrongs;
                            subTopics.push({
                                name: prefix ? `${prefix} → ${key}` : key,
                                wrongs: wrongs
                            });
                        }
                    } else {
                        extractLeafTopics(val, prefix ? `${prefix} → ${key}` : key);
                    }
                }
            }
        }

        extractLeafTopics(categoryData);

        if (categoryTotalWrongs > 0 && subTopics.length > 0) {
            categories.push({
                title: catKey,
                totalWrongs: categoryTotalWrongs,
                subTopics: subTopics
            });
        }
    }

    if (categories.length === 0) {
        container.innerHTML = `<p style="font-size: 0.85rem; color: #10b981; font-weight: 500;">✨ No wrong attempts recorded across any concepts!</p>`;
        return;
    }

    categories.sort((a, b) => b.totalWrongs - a.totalWrongs);

    container.innerHTML = categories.map((cat, idx) => {
        const detailsId = `concept-detail-${idx}`;
        const btnId = `concept-btn-${idx}`;

        return `
            <div style="background: var(--card-bg, #ffffff); border: 1px solid var(--border, #e2e8f0); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-weight: 700; font-size: 0.9rem; text-transform: capitalize; color: var(--text-main, #1e293b);">
                            ${cat.title}
                        </span>
                        <div style="font-size: 0.75rem; color: #ef4444; font-weight: 600; margin-top: 2px;">
                            ${cat.totalWrongs} Total Wrong Attempt${cat.totalWrongs > 1 ? 's' : ''}
                        </div>
                    </div>
                    
                    <button id="${btnId}" onclick="toggleConceptDetail('${detailsId}', '${btnId}')" 
                            style="background: transparent; color: #3b82f6; border: 1px solid #3b82f6; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s ease;">
                        <span>View Details</span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                </div>

                <div id="${detailsId}" style="display: none; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border, #e2e8f0); flex-direction: column; gap: 6px;">
                    ${cat.subTopics.map(sub => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: rgba(0,0,0,0.02); border-radius: 4px;">
                            <span style="font-size: 0.8rem; color: var(--text-muted, #64748b); font-weight: 500;">
                                - ${sub.name}
                            </span>
                            <span style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; padding: 1px 8px; border-radius: 10px; font-weight: 700; font-size: 0.75rem;">
                                ${sub.wrongs} wrong
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join("");
}

window.toggleConceptDetail = function(detailsId, btnId) {
    const detailsEl = document.getElementById(detailsId);
    const btnEl = document.getElementById(btnId);
    if (!detailsEl || !btnEl) return;

    const isHidden = detailsEl.style.display === "none";
    detailsEl.style.display = isHidden ? "flex" : "none";

    btnEl.innerHTML = isHidden 
        ? `<span>Hide Details</span> <i class="bi bi-chevron-up"></i>` 
        : `<span>View Details</span> <i class="bi bi-chevron-down"></i>`;
};

window.viewStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    document.getElementById("student-details-modal").style.display = "flex";
    document.getElementById("modal-student-name").textContent = student.name;
    document.getElementById("modal-student-id").textContent = student.id;
    
    const birthdayText = student.birthday ? student.birthday : "No Birthday Saved";
    document.getElementById("modal-student-birthday").textContent = `Birthday: ${birthdayText}`;
    
    document.getElementById("modal-progress").textContent = (student.progress || 0) + "%";
    document.getElementById("modal-idle").textContent = (student.idleTime || "0") + "m";
    renderConceptBreakdown(student);

    const topics = [
        "C# Basic Concepts",
        "Conditionals and Loops",
        "Methods",
        "Classes and Objects",
        "Arrays and Strings",
        "Advanced Class Concepts",
        "Inheritance & Polymorphism"
    ];

    const difficulty = student.difficulty || [0, 0, 0, 0, 0, 0, 0];
    const highest = Math.max(...difficulty);
    const weakestIndex = difficulty.indexOf(highest);

    document.getElementById("modal-difficulty").textContent = `${highest}/10`;
    document.getElementById("modal-weakest-topic").textContent = topics[weakestIndex] || "--";

    const statusBox = document.getElementById("status-card");
    const statusTitle = document.getElementById("modal-status-title");
    const perfText = document.getElementById("modal-performance-text");
    const analysisBox = document.getElementById("modal-analysis-content");

    if (highest >= 7) {
        if (statusBox) {
            statusBox.style.borderLeft = "6px solid #ef4444";
            statusBox.style.background = "#fef2f2";
        }
        if (statusTitle) statusTitle.textContent = "Critical Intervention";
        if (perfText) {
            perfText.textContent = "At Risk";
            perfText.className = "text-red";
        }
        if (analysisBox) {
            analysisBox.innerHTML = `
                <div style="border-left: 4px solid #ef4444; padding: 10px; background: #fef2f2;">
                    <strong style="color: #b91c1c;">Gap Detected: ${topics[weakestIndex]}</strong>
                    <p style="font-size: 0.85rem; margin-top: 5px; color: #b91c1c;">
                        Repeated incorrect attempts in ${topics[weakestIndex]}. Recommend review of Laboratory Activity 1-3.
                    </p>
                </div>`;
        }
    } else {
        if (statusBox) {
            statusBox.style.borderLeft = "6px solid #10b981";
            statusBox.style.background = "#f0fdf4";
        }
        if (statusTitle) statusTitle.textContent = "Good Progress (C# Mastery)";
        if (perfText) {
            perfText.textContent = "On Track";
            perfText.className = "text-green";
        }
        if (analysisBox) {
            analysisBox.innerHTML = `
                <div style="border-left: 4px solid #10b981; padding: 10px; background: #f0fdf4;">
                    <strong style="color: #15803d;">Performance: On Track</strong>
                    <p style="font-size: 0.85rem; margin-top: 5px; color: #15803d;">
                        Student demonstrates strong understanding. Ready for 1st Periodical Examination.
                    </p>
                </div>`;
        }
    }

    const ctx = document.getElementById("modalDifficultyChart")?.getContext("2d");
    if (ctx) {
        if (window.modalDifficultyChart instanceof Chart) {
            window.modalDifficultyChart.destroy();
        }

        window.modalDifficultyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ["Basics", "Logic", "Methods", "Classes", "Arrays", "Adv. Class", "OOP"],
                datasets: [{
                    data: difficulty,
                    borderRadius: 6,
                    backgroundColor: difficulty.map(v => v >= 7 ? '#ef4444' : (v >= 4 ? '#f59e0b' : '#10b981'))
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, max: 10, ticks: { stepSize: 2 } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};

window.closeStudentModal = function(){
    document.getElementById("student-details-modal").style.display = "none";
};
function updateRecommendations(conceptMapOverall, totalStudentsCount) {
    const container = document.getElementById("recommendations-container");
    if (!container) return;

    // Find concept with highest student struggle count
    let maxCount = 0;
    let topTroubleConcept = null;

    for (const [concept, count] of Object.entries(conceptMapOverall)) {
        if (count > maxCount) {
            maxCount = count;
            topTroubleConcept = concept;
        }
    }

    if (!topTroubleConcept || maxCount === 0) {
        container.innerHTML = `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 8px;">
                <strong style="color: #15803d; font-size: 0.9rem;">✨ Excellent Class Performance</strong>
                <p style="font-size: 0.8rem; color: #166534; margin-top: 4px;">
                    No major learning roadblocks detected. Students are progressing smoothly.
                </p>
            </div>
        `;
        return;
    }

    const percentage = totalStudentsCount > 0 
        ? Math.round((maxCount / totalStudentsCount) * 100) 
        : 0;

    const formattedConceptName = topTroubleConcept.replace(/_/g, ' ').toUpperCase();

    container.innerHTML = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: #b91c1c; font-size: 0.85rem;">⚠️ High Risk Category</strong>
                <span style="background: #ef4444; color: white; border-radius: 12px; padding: 2px 8px; font-size: 0.75rem; font-weight: bold;">
                    ${maxCount} Students (${percentage}%)
                </span>
            </div>
            <p style="font-size: 0.8rem; color: #991b1b; margin-top: 4px; font-weight: 600;">
                Focus Area: ${formattedConceptName}
            </p>
        </div>

        <div style="background: var(--bg-secondary, #f8fafc); border-left: 4px solid #3b82f6; padding: 10px 12px; border-radius: 4px;">
            <strong style="font-size: 0.82rem; color: var(--text-main, #1e293b);">💡 Recommended Actions:</strong>
            <ul style="margin: 6px 0 0 16px; padding: 0; font-size: 0.78rem; color: var(--text-muted, #475569); line-height: 1.4;">
                <li>Conduct a quick 10-minute recap session focusing on <strong>${formattedConceptName}</strong>.</li>
                <li>Provide step-by-step visual tracing exercises before coding.</li>
                <li>Assign pair programming or guided practice activities to support struggling learners.</li>
            </ul>
        </div>
    `;
}
function renderGapChart(data) {
    const ctx = document.getElementById("gapChart")?.getContext("2d");
    if (!ctx) return;
    if (gapChart) gapChart.destroy();

    gapChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ["Variables", "Control Flow", "Loops", "Functions", "Firestore"],
            datasets: [{
                label: 'Difficulty Level',
                data: data,
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                borderColor: '#ef4444',
                pointBackgroundColor: '#ef4444',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 10,
                    ticks: { display: false }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function calculateDifficulty(wrongs, timeInSeconds) {
    let score = (wrongs * 0.5) + (timeInSeconds / 60);
    return Math.min(Math.round(score), 10);
}

function renderGapConclusion(student, difficulty) {
    const container = document.getElementById("student-analysis");
    if (!container) return;

    const maxVal = Math.max(...difficulty);
    const gapIndex = difficulty.indexOf(maxVal);
    const topic = COURSE_OUTLINE[gapIndex];
    
    const levelStats = student.gameStats ? student.gameStats[`level${gapIndex + 1}`] : null;

    let detailNote = "";
    if (levelStats) {
        detailNote = `caused by <b>${levelStats.wrongs} incorrect attempts</b> and <b>${Math.round(levelStats.time / 60)} minutes</b> spent on this level.`;
    }

    let statement = "";
    if (maxVal > 7) {
        statement = `<strong>Critical Gap:</strong> ${student.name} is stuck on ${topic.lesson}. ${detailNote}`;
    } else if (maxVal > 0) {
        statement = `<strong>Minor Struggle:</strong> ${student.name} completed ${topic.lesson}, but showed some hesitation ${detailNote}`;
    } else {
        statement = `<strong>Perfect Run:</strong> No errors or delays recorded for current levels.`;
    }

    container.innerHTML = `
        <div style="padding: 15px; background: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px;">
            ${statement}
        </div>
    `;
}

function renderStudentChart(student) {
    const ctx = document.getElementById("difficultyChart")?.getContext("2d");
    if (!ctx) return;

    if (difficultyChart) difficultyChart.destroy();

    const difficulty = student.difficulty || [0,0,0,0,0];

    const labels = [
        "Variables & Data Types",
        "If-Else Statements",
        "Loops",
        "Functions",
        "Firestore"
    ];

    difficultyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Difficulty Level',
                data: difficulty,
                borderRadius: 10,
                borderSkipped: false,
                backgroundColor: difficulty.map(v => {
                    if (v >= 7) return '#ef4444';
                    if (v >= 4) return '#f59e0b';
                    return '#10b981';
                })
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            if (value >= 7) return `Hard Difficulty (${value}/10)`;
                            if (value >= 4) return `Moderate Difficulty (${value}/10)`;
                            return `Easy Difficulty (${value}/10)`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 10,
                    ticks: { stepSize: 1 },
                    title: { display: true, text: "Difficulty Score" }
                }
            }
        }
    });

    renderAdvancedAnalysis(student);
}

function renderAdvancedAnalysis(student) {
    const container = document.getElementById("student-analysis");
    if (!container) return;

    const difficulty = student.difficulty || [0,0,0,0,0];

    const topics = [
        {
            lesson: "Variables & Data Types",
            explanation: "Student struggles in understanding variable declaration, assigning values, and identifying proper data types."
        },
        {
            lesson: "If-Else Statements",
            explanation: "Student struggles in understanding decision making and logical conditions."
        },
        {
            lesson: "Loops",
            explanation: "Student struggles in repetition logic and controlling loop execution."
        },
        {
            lesson: "Functions",
            explanation: "Student struggles in method creation, parameters, and code organization."
        },
        {
            lesson: "Firestore",
            explanation: "Student struggles in database integration and backend communication."
        }
    ];

    const highest = Math.max(...difficulty);
    const weakestIndex = difficulty.indexOf(highest);
    const weakestTopic = topics[weakestIndex];

    let level = "";
    let recommendation = "";
    let severityColor = "";

    if (highest >= 7) {
        level = "Critical Learning Gap";
        severityColor = "#ef4444";
        recommendation = "Teacher should reteach this lesson step-by-step with visual demonstrations and guided coding exercises.";
    } else if (highest >= 4) {
        level = "Moderate Difficulty";
        severityColor = "#f59e0b";
        recommendation = "Student understands some concepts but still needs additional practice and reinforcement activities.";
    } else {
        level = "Good Understanding";
        severityColor = "#10b981";
        recommendation = "Student shows good understanding and may proceed to more advanced challenges.";
    }

    let wrongs = 0;
    let timeSpent = 0;

    if (student.gameStats && student.gameStats[weakestIndex]) {
        wrongs = student.gameStats[weakestIndex].wrongs || 0;
        timeSpent = student.gameStats[weakestIndex].time || 0;
    }

    let teacherInsight = "";
    if (wrongs >= 5) {
        teacherInsight = "The student repeatedly made incorrect attempts, indicating confusion with the lesson logic rather than simple syntax errors.";
    } else if (timeSpent >= 300) {
        teacherInsight = "The student spent a long time solving the activity, suggesting hesitation and lack of confidence.";
    } else {
        teacherInsight = "The student was able to continue with manageable difficulty.";
    }

    container.innerHTML = `
        <div style="background:white; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:18px; box-shadow:0 4px 15px rgba(0,0,0,0.08);">
            <div style="padding:15px; border-left:6px solid ${severityColor}; background:#f8fafc; border-radius:8px;">
                <h3 style="margin:0; color:${severityColor};">${level}</h3>
                <p style="margin-top:10px; line-height:1.6;">
                    <strong>${student.name}</strong> is currently struggling most in <strong>${weakestTopic.lesson}</strong>.
                </p>
                <p style="line-height:1.6;">${weakestTopic.explanation}</p>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:15px;">
                <div style="background:#f1f5f9; padding:15px; border-radius:10px;">
                    <h4>Wrong Attempts</h4>
                    <div style="font-size:28px; font-weight:bold; color:#ef4444;">${wrongs}</div>
                </div>
                <div style="background:#f1f5f9; padding:15px; border-radius:10px;">
                    <h4>Time Spent</h4>
                    <div style="font-size:28px; font-weight:bold; color:#3b82f6;">${Math.round(timeSpent / 60)} mins</div>
                </div>
                <div style="background:#f1f5f9; padding:15px; border-radius:10px;">
                    <h4>Difficulty Score</h4>
                    <div style="font-size:28px; font-weight:bold; color:#f59e0b;">${highest}/10</div>
                </div>
            </div>

            <div style="background:#eff6ff; padding:18px; border-radius:10px; border-left:5px solid #3b82f6;">
                <h4 style="margin-top:0;">Teacher Insight</h4>
                <p style="line-height:1.7;">${teacherInsight}</p>
            </div>

            <div style="background:#f0fdf4; padding:18px; border-radius:10px; border-left:5px solid #10b981;">
                <h4 style="margin-top:0;">Suggested Intervention</h4>
                <p style="line-height:1.7;">${recommendation}</p>
            </div>
        </div>
    `;
}

// 6. EXCEL IMPORT LOGIC
window.updateFileName = function(input) {
    const label = document.getElementById("file-name-text"); 
    if (input.files.length > 0) {
        const name = input.files[0].name;
        if(label) {
            label.textContent = name;
            label.style.fontWeight = "600";
        }
    }
};

function excelDateToJSDate(value) {
    if (typeof value === "number") {
        const date = new Date((value - 25569) * 86400 * 1000);
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    if (typeof value === "string") {
        const raw = value.trim();
        const parts = raw.split(/[\/\-\.]/);

        if (parts.length === 3) {
            let [day, month, year] = parts;
            day = day.padStart(2, "0");
            month = month.padStart(2, "0");

            if (year.length === 2) {
                year = "20" + year;
            }
            return `${year}-${month}-${day}`;
        }
    }
    return "";
}

window.importExcel = async function () {
    const input = document.getElementById("excel-input");
    const sectionSelect = document.getElementById("section-select");
    const label = document.getElementById("file-name-text");

    if (!input.files.length) return alert("Please choose a file first!");
    if (!sectionSelect.value) return alert("Please select a section before importing!");

    const selectedSectionName = sectionSelect.value;
    const parentDocId = sectionDocMapping[selectedSectionName];

    const reader = new FileReader();
    reader.onload = async (e) => {
        toggleLoading(true);
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            const batch = writeBatch(db);

            const allExistingIds = new Set(allStudents.map(s => String(s.id)));

            try {
                const archiveSnap = await getDocs(collection(db, "archivedStudents"));
                archiveSnap.forEach(doc => {
                    allExistingIds.add(String(doc.id));
                });
                console.log(`✅ Found ${archiveSnap.size} archived students - preventing duplicates`);
            } catch (archiveError) {
                console.warn("Could not check archive collection:", archiveError);
            }

            let addedCount = 0;
            let skippedCount = 0;
            let skippedActiveCount = 0;
            let skippedArchiveCount = 0;

            data.forEach(row => {
                const values = Object.values(row);

                const sId = String(values[0] || "").trim();
                const sName = values[1] || "Unknown";
                const sEmail = values[2] || "No Email";
                const rawBirthday = values[3];

                const sBirthday = excelDateToJSDate(rawBirthday);
                const sPassword = formatBirthdayToPassword(sBirthday);

                if (!sId) return;

                if (!allExistingIds.has(sId)) {
                    const studentRef = doc(db, "sections", parentDocId, "classList", sId);

                    batch.set(studentRef, {
                        id: sId,
                        name: sName,
                        email: sEmail,
                        birthday: sBirthday,
                        password: sPassword,
                        progress: 0,
                        idleTime: "0m",
                        difficulty: [0, 0, 0, 0, 0],
                        attempts: []
                    });

                    addedCount++;
                    allExistingIds.add(sId);
                } else {
                    skippedCount++;
                    const isActive = allStudents.some(s => s.id === sId);
                    if (isActive) {
                        skippedActiveCount++;
                    } else {
                        skippedArchiveCount++;
                    }
                }
            });

            if (addedCount > 0) {
                await batch.commit();
                alert(`Import Complete!\n` +
                      `Added: ${addedCount} new students\n` +
                      `Skipped Active: ${skippedActiveCount}\n` +
                      `Skipped Archived: ${skippedArchiveCount}`);
                await fetchClassList();
            } else {
                alert(`No new students found.\n` +
                      `Active duplicates: ${skippedActiveCount}\n` +
                      `Archived duplicates: ${skippedArchiveCount}`);
            }

            input.value = "";
            if (label) {
                label.textContent = "Choose File";
                label.style.fontWeight = "normal";
            }

        } catch (err) {
            console.error(err);
            alert("Error reading Excel file.");
        } finally {
            toggleLoading(false);
        }
    };

    reader.readAsArrayBuffer(input.files[0]);
};

window.handlePasswordReset = function() {
    const modal = document.getElementById("reset-password-modal");
    const sectionDrop = document.getElementById("reset-section-select");
    const searchInput = document.getElementById("reset-search-input");
    const studentDrop = document.getElementById("reset-student-select");
    
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
    searchInput.value = "";
    
    sectionDrop.innerHTML = '<option value="">-- Select Section --</option>';
    currentUserSection.forEach(sec => {
        const opt = document.createElement("option");
        opt.value = sec;
        opt.textContent = sec;
        sectionDrop.appendChild(opt);
    });

    const filterResetList = () => {
        const selectedSec = sectionDrop.value;
        const term = searchInput.value.toLowerCase();
        
        studentDrop.innerHTML = '';
        
        if (!selectedSec) {
            studentDrop.innerHTML = '<option disabled>Please select a section first...</option>';
            return;
        }

        const filtered = allStudents.filter(s => {
            const matchesSection = s.section === selectedSec;
            const matchesSearch = s.name.toLowerCase().includes(term) || 
                                  s.id.toString().includes(term);
            return matchesSection && matchesSearch;
        });

        if (filtered.length === 0) {
            studentDrop.innerHTML = '<option disabled>No students found...</option>';
        } else {
            filtered.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.id})`;
                studentDrop.appendChild(opt);
            });
        }
    };

    sectionDrop.onchange = filterResetList;
    searchInput.oninput = filterResetList;

    modal.style.display = "flex";
};

window.closeResetModal = () => {
    document.getElementById("reset-password-modal").style.display = "none";
};

window.confirmResetSelection = function() {
    const studentId = document.getElementById("reset-student-select").value;
    
    if (!studentId) {
        alert("Please select a student from the list!");
        return;
    }

    const student = allStudents.find(s => s.id === studentId);
    
    document.getElementById("reset-step-1").style.display = "none";
    document.getElementById("reset-step-2").style.display = "block";
    document.getElementById("reset-confirm-text").innerHTML = 
        `<i class="bi bi-exclamation-triangle"></i> You are about to reset the password for <b>${student.name}</b>. This action cannot be undone.`;

    document.getElementById("final-reset-btn").onclick = () => saveNewPassword(student);
};

window.backToStep1 = () => {
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
};

async function saveNewPassword(student) {
    const newPass = document.getElementById("new-password-input").value.trim();
    if (newPass.length < 4) {
        alert("Password must be at least 4 characters long.");
        return;
    }

    toggleLoading(true);
    try {
        const studentRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        
        await updateDoc(studentRef, {
            password: newPass
        });

        alert(`Success! Password for ${student.name} has been updated.`);
        closeResetModal();
        await fetchClassList();
    } catch (error) {
        console.error("Firestore Update Error:", error);
        alert("Failed to update password. Please check your connection.");
    } finally {
        toggleLoading(false);
    }
}

// Event Listeners
document.getElementById("excel-input")?.addEventListener("change", function() {
    updateFileName(this);
});

document.getElementById("section-select")?.addEventListener("change", (e) => loadStudents(e.target.value));
document.getElementById("search-student")?.addEventListener("input", () => {
    const sec = document.getElementById("section-select").value;
    loadStudents(sec);
});

// 7. LESSON GAP ANALYSIS ENGINE
function generateInstructorSummary(students) {
    if (!students || students.length === 0) {
        return "No student data available for analysis.";
    }

    let avgProgress = students.reduce((acc, s) => acc + (s.progress || 0), 0) / students.length;

    let avgIdle = students.reduce((acc, s) => {
        let time = parseInt((s.idleTime || "0").replace("m", ""));
        return acc + (isNaN(time) ? 0 : time);
    }, 0) / students.length;

    let difficultyTotals = [0, 0, 0, 0, 0];

    students.forEach(s => {
        (s.difficulty || [0,0,0,0,0]).forEach((val, i) => {
            difficultyTotals[i] += val;
        });
    });

    let difficultyAvg = difficultyTotals.map(d => d / students.length);

    let maxDifficulty = Math.max(...difficultyAvg);
    let hardestLevelIndex = difficultyAvg.indexOf(maxDifficulty);
    let hardestLevel = `Level ${hardestLevelIndex + 1}`;

    let roadblock = "";
    let reason = "";
    let recommendation = "";

    if (maxDifficulty >= 7) {
        roadblock = `${hardestLevel} - Complex Logic & Problem Solving`;
        reason = `Students show high difficulty (${maxDifficulty.toFixed(1)}/10) at ${hardestLevel}, indicating they struggle when tasks require combining multiple concepts.`;
        recommendation = `Break the problem into smaller steps and guide students through each step before coding. Encourage them to explain their logic before writing code.`;
    } else if (avgProgress < 50) {
        roadblock = `Early Programming Concepts (Variables / Output)`;
        reason = `Average progress is only ${Math.round(avgProgress)}%, suggesting students are not confidently completing even basic tasks.`;
        recommendation = `Reinforce fundamentals using simple examples and repetition. Use guided exercises before independent tasks.`;
    } else if (avgIdle > 10) {
        roadblock = `Code Understanding & Debugging`;
        reason = `High idle time (~${Math.round(avgIdle)} minutes) suggests students are getting stuck and unsure how to proceed.`;
        recommendation = `Introduce step-by-step tracing. Ask students to predict outputs before running their code.`;
    } else {
        roadblock = `Applying Concepts Independently`;
        reason = `Students perform well initially but show difficulty as tasks become less guided.`;
        recommendation = `Provide scaffolded challenges that gradually reduce hints to build independence.`;
    }

    return `
        <strong>📌 Identified Roadblock:</strong><br>
        ${roadblock}
        <br><br>

        <strong>📊 Why This is Happening:</strong><br>
        ${reason}
        <br><br>

        <strong>✅ Teaching Recommendation:</strong><br>
        ${recommendation}
    `;
}

// 8. UPDATE UI WITH SUMMARY
function updateInstructorSummary(filteredStudents) {
    const container = document.getElementById("instructor-summary-content");
    if (!container) return;

    const summary = generateInstructorSummary(filteredStudents);
    container.innerHTML = summary;
}

window.logoutUser = async () => {
    try {
        await signOut(auth);
        window.location.href = '../index.html'; 
    } catch (error) {
        console.error("Logout error", error);
    }
};

window.closeLogoutPopup = () => {
    document.getElementById("logout-popup").style.display = "none";
};

window.showLogoutPopup = () => {
    document.getElementById("logout-popup").style.display = "flex";
};

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeToggleBtn = document.getElementById("theme-toggle");
    if (themeToggleBtn) {
        const icon = themeToggleBtn.querySelector("i");
        if (icon) {
            icon.className = (theme === "dark") ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'light';
    applyTheme(savedTheme);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = localStorage.getItem('dashboard-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            localStorage.setItem('dashboard-theme', newTheme);
            applyTheme(newTheme);
        });
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === 'dashboard-theme') {
        const newTheme = event.newValue;
        applyTheme(newTheme);
    }
});