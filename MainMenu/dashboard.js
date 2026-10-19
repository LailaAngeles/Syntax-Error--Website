import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, getDocs, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

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
const auth = getAuth(app);

// Global State
let allStudentsData = [];
let mySections = [];
let trendChart;
let unsubscribeTeacher = null;
let unsubscribeSections = null;
const teacherClassListeners = new Map();
const teacherClassData = new Map();

function stopTeacherListeners() {
    if (unsubscribeTeacher) { unsubscribeTeacher(); unsubscribeTeacher = null; }
    if (unsubscribeSections) { unsubscribeSections(); unsubscribeSections = null; }
    teacherClassListeners.forEach(stop => stop());
    teacherClassListeners.clear();
    teacherClassData.clear();
}

function renderLiveTeacherData() {
    allStudentsData = Array.from(teacherClassData.values()).flat();
    const selected = document.getElementById("section-select")?.value || "";
    const leaderboardSection = document.getElementById("leaderboard-section-select")?.value || "";
    updateLeaderboard(leaderboardSection);
    renderAnalytics(selected);
}


// Dynamic Concepts list fallback
const concepts = [
    "C# Basic Concepts (Variables, I/O)",
    "Conditionals and Loops",
    "Methods (Overloading, Recursion)",
    "Classes and Objects",
    "Arrays and Strings",
    "Advanced Classes (Static, Indexers)",
    "Inheritance and Polymorphism",
    "Exceptions and Files",
    "Generics and Collections"
];

// ----------------------------
// 1. AUTH & DATA LOADING
// ----------------------------
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        stopTeacherListeners();
        window.location.href = "../index.html";
        return;
    }
    await loadTeacherDashboard(user);
});

// --- THEME ENGINE INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    const themeToggleBtn = document.getElementById("theme-toggle");
    const htmlElement = document.documentElement;

    const savedTheme = localStorage.getItem("dashboard-theme") || "light";
    htmlElement.setAttribute("data-theme", savedTheme);
    updateToggleIcon(savedTheme);

    themeToggleBtn?.addEventListener("click", () => {
        const currentTheme = htmlElement.getAttribute("data-theme");
        const newTheme = currentTheme === "light" ? "dark" : "light";
        
        htmlElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("dashboard-theme", newTheme);
        updateToggleIcon(newTheme);
    });

    function updateToggleIcon(theme) {
        const icon = themeToggleBtn?.querySelector("i");
        if (icon) {
            icon.className = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
        }
    }
});

async function loadTeacherDashboard(user) {
    stopTeacherListeners();
    const loader = document.getElementById("loading-overlay");
    if (loader) loader.style.display = "flex";

    let assignedSections = [];
    let sectionsSnapshot = null;

    function syncTeacherSections() {
        if (!sectionsSnapshot) return;
        const select = document.getElementById("section-select");
        const previousSelection = select?.value || "";
        if (select) select.innerHTML = '<option value="">All My Sections</option>';
        const wanted = new Map();

        sectionsSnapshot.forEach(sDoc => {
            const name = sDoc.data().name;
            if (!assignedSections.includes(name)) return;
            wanted.set(sDoc.id, name);
            if (select) {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            }
        });
        if (select && [...select.options].some(option => option.value === previousSelection)) {
            select.value = previousSelection;
        }
        teacherClassListeners.forEach((stop, id) => {
            if (!wanted.has(id)) {
                stop();
                teacherClassListeners.delete(id);
                teacherClassData.delete(id);
            }
        });
        wanted.forEach((name, id) => {
            // A section name change should also update its displayed students.
            if (teacherClassListeners.has(id)) return;
            const stop = onSnapshot(collection(db, "sections", id, "classList"), snap => {
                teacherClassData.set(id, snap.docs.map(student => ({
                    ...student.data(), section: wanted.get(id) || name
                })));
                renderLiveTeacherData();
            }, error => console.error("Teacher class listener error:", error));
            teacherClassListeners.set(id, stop);
        });
        teacherClassData.forEach((students, id) => {
            const name = wanted.get(id);
            if (name) students.forEach(student => { student.section = name; });
        });
        const leaderboardSelect = document.getElementById("leaderboard-section-select");
        const previousLeaderboard = leaderboardSelect?.value || "";
        initLeaderboardDropdown();
        if (leaderboardSelect && [...leaderboardSelect.options].some(opt => opt.value === previousLeaderboard)) {
            leaderboardSelect.value = previousLeaderboard;
        }
        renderLiveTeacherData();
        if (loader) loader.style.display = "none";
    }

    const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
    unsubscribeTeacher = onSnapshot(q, snap => {
        assignedSections = [];
        snap.forEach(d => { assignedSections = d.data().section || []; });
        mySections = assignedSections;
        const display = document.getElementById("user-section-display");
        if (display) display.textContent = mySections.join(", ");
        syncTeacherSections();
    }, error => { console.error("Teacher permission listener error:", error); if (loader) loader.style.display = "none"; });

    unsubscribeSections = onSnapshot(collection(db, "sections"), snap => {
        sectionsSnapshot = snap;
        syncTeacherSections();
    }, error => { console.error("Teacher sections listener error:", error); if (loader) loader.style.display = "none"; });
}

// Helper to extract whole-number metrics safely from Firestore nested maps
function extractNumericMetrics(obj) {
    let total = 0;
    let count = 0;

    function recurse(node) {
        if (node === null || node === undefined) return;
        if (typeof node === "number" && node >= 1 && node <= 10) {
            total += node;
            count++;
        } else if (typeof node === "string") {
            const parsed = parseFloat(node);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                total += parsed;
                count++;
            }
        } else if (typeof node === "object") {
            Object.values(node).forEach(val => recurse(val));
        }
    }

    recurse(obj);
    return count > 0 ? Math.round(total / count) : 3;
}

// ----------------------------
// 2. CORE ANALYTICS LOGIC
// ----------------------------
function renderAnalytics(filterSection) {
    const table = document.getElementById("analytics-table");
    if (!table) return;
    table.innerHTML = "";

    const students = filterSection ? allStudentsData.filter(s => s.section === filterSection) : allStudentsData;
    
    let criticalCount = 0;
    let masteryCount = 0;
    let reviewCount = 0;
    const avgScores = [];
    const dynamicTopicsMap = {};

    students.forEach(s => {
        const subContent = s["Subject Content"] || s.subjectContent;
        if (subContent && typeof subContent === "object") {
            Object.keys(subContent).forEach(mainCat => {
                const catData = subContent[mainCat];
                if (!dynamicTopicsMap[mainCat]) {
                    dynamicTopicsMap[mainCat] = { total: 0, count: 0 };
                }
                const metric = extractNumericMetrics(catData);
                dynamicTopicsMap[mainCat].total += (metric > 0 ? metric : 3);
                dynamicTopicsMap[mainCat].count += 1;
            });
        }
    });

    const dynamicKeys = Object.keys(dynamicTopicsMap);
    
    if (dynamicKeys.length > 0) {
        dynamicKeys.forEach((topicLabel) => {
            const stats = dynamicTopicsMap[topicLabel];
            const avg = stats.count > 0 ? Math.round(stats.total / stats.count) : 0;
            avgScores.push(avg);

            let status, badgeClass;
            if (avg >= 8) {
                status = "Hardest Topic"; 
                badgeClass = "red-badge";
                criticalCount++;
            } else if (avg >= 5) {
                status = "Needs Review";
                badgeClass = "orange-badge";
                reviewCount++;
            } else {
                status = "Mastered";
                badgeClass = "green-badge";
                masteryCount++;
            }

            table.innerHTML += `
                <tr>
                    <td><strong>${topicLabel}</strong></td>
                    <td>${avg} / 10</td>
                    <td><span class="status-dot ${badgeClass}">${status}</span></td>
                </tr>
            `;
        });
    } else {
        concepts.forEach((concept, i) => {
            let totalScore = 0;
            let count = 0;

            students.forEach(s => {
                if (s.difficulty && s.difficulty[i] !== undefined) {
                    totalScore += Number(s.difficulty[i]);
                    count++;
                }
            });

            const avg = count > 0 ? Math.round(totalScore / count) : 0;
            avgScores.push(avg);

            let status, badgeClass;
            if (avg >= 8) {
                status = "Hardest Topic"; badgeClass = "red-badge"; criticalCount++;
            } else if (avg >= 5) {
                status = "Needs Review"; badgeClass = "orange-badge"; reviewCount++;
            } else {
                status = "Mastered"; badgeClass = "green-badge"; masteryCount++;
            }

            table.innerHTML += `
                <tr>
                    <td><strong>Module ${i+1}:</strong> ${concept}</td>
                    <td>${avg} / 10</td>
                    <td><span class="status-dot ${badgeClass}">${status}</span></td>
                </tr>
            `;
        });
    }

    document.getElementById("total-students").textContent = students.length;
    document.getElementById("at-risk-count").textContent = criticalCount;
    const totalConceptsTracked = dynamicKeys.length > 0 ? dynamicKeys.length : concepts.length;
    const rate = students.length > 0 && totalConceptsTracked > 0 ? Math.round((masteryCount / totalConceptsTracked) * 100) : 0;
    document.getElementById("mastery-rate").textContent = rate + "%";

    updateTrendChart(avgScores, dynamicKeys.length > 0 ? dynamicKeys : concepts.map((_, i) => `Mod ${i+1}`));
    updateMasteryDistributionList(students);
}

// ----------------------------
// 3. CHARTS & LEADERBOARDS
// ----------------------------
function updateTrendChart(dataValues, labelsList) {
    const canvas = document.getElementById("overallDifficultyChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labelsList,
            datasets: [{
                label: 'Avg Difficulty Score',
                data: dataValues,
                backgroundColor: 'rgba(59, 130, 246, 0.75)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.65
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false 
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    max: 10,
                    ticks: {
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(200, 200, 200, 0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 30,
                        minRotation: 0,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

// Aggregate task completionTime, not elapsedLevelSeconds. The same task
// has only one contribution per student, chosen from its latest numbered attempt.
function getTopicTimeRanking(students) {
    const normalize = key => String(key ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const attemptNumber = key => ({ firstattemp:1, firstattempt:1, secondattemp:2, secondattempt:2,
        thirdattemp:3, thirdattempt:3 })[normalize(key)] || 0;
    const validTime = value => (typeof value === 'number' || typeof value === 'string') &&
        String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
    const timestamp = value => {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const t = Date.parse(value); return Number.isFinite(t) ? t : 0;
    };
    const totals = new Map();
    students.forEach((student, studentIndex) => {
        const subjects = student?.['Subject Content'] || student?.subjectContent;
        if (!subjects || typeof subjects !== 'object') return;
        const contributorId = String(student.id || student.studentId || studentIndex) + '|' + String(student.section || '');
        for (const [topic, branch] of Object.entries(subjects)) {
            if (!branch || typeof branch !== 'object') continue;
            const tasks = new Map();
            const seen = new WeakSet();
            function walk(node, path, attempt, depth) {
                if (!node || typeof node !== 'object' || depth > 30 || seen.has(node)) return;
                if (typeof node.toDate === 'function') return;
                seen.add(node);
                if (Array.isArray(node)) { node.forEach((v,i) => walk(v, [...path,String(i)], attempt,depth+1)); return; }
                if (validTime(node.completionTime)) {
                    // Identify the same activity across First/Second/Third attempt branches.
                    // Nested context is retained; attempt names are omitted from the key.
                    const taskKey = path.filter(part => !attemptNumber(part)).join(' / ') || '(topic summary)';
                    const candidate = {seconds:Number(node.completionTime), attempt,
                        when:timestamp(node.completedAt || node.updatedAt || node.lastAttempt)};
                    const prior = tasks.get(taskKey);
                    if (!prior || candidate.attempt > prior.attempt ||
                        (candidate.attempt === prior.attempt && candidate.when > prior.when)) tasks.set(taskKey,candidate);
                }
                for (const [key,value] of Object.entries(node)) {
                    if (!value || typeof value !== 'object') continue;
                    walk(value,[...path,key],attemptNumber(key) || attempt,depth+1);
                }
            }
            walk(branch,[],0,0);
            // Same-level summary times and individual tasks must not both be counted.
            const specific = [...tasks.entries()].filter(([name]) => name !== '(topic summary)');
            const contributions = specific.length ? specific : [...tasks.entries()];
            const topicSeconds = contributions.reduce((sum,[,result]) => sum + result.seconds,0);
            if (!contributions.length) continue;
            const key=normalize(topic);
            if (!totals.has(key)) totals.set(key,{name:topic,seconds:0,students:new Set(),tasks:0});
            const entry=totals.get(key);
            entry.seconds+=topicSeconds;
            entry.students.add(contributorId);
            entry.tasks+=contributions.length;
        }
    });
    return [...totals.values()].sort((a,b)=>b.seconds-a.seconds || a.name.localeCompare(b.name));
}

function formatTopicDuration(seconds) {
    const total=Math.round(seconds);
    if (total >= 3600) return `${Math.floor(total/3600)}h ${Math.floor((total%3600)/60)}m`;
    return `${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s`;
}

function updateLeaderboard(sectionId) {
    const list=document.getElementById('leaderboard-list');
    if (!list) return;
    const students=sectionId ? allStudentsData.filter(s=>s.section===sectionId) : allStudentsData;
    const ranking=getTopicTimeRanking(students);
    list.replaceChildren();
    if (!ranking.length) {
        const li=document.createElement('li'); li.className='leaderboard-item empty-state';
        li.textContent='No recorded completion times for this selection yet.';
        list.append(li); return;
    }
    const max=ranking[0].seconds || 1;
    ranking.forEach((topic,index)=>{
        const item=document.createElement('li'); item.className='topic-time-item';
        const heading=document.createElement('div'); heading.className='topic-time-item-head';
        const title=document.createElement('strong'); title.textContent=`${index+1}. ${topic.name}`;
        const total=document.createElement('strong'); total.className='topic-time-total';
        total.textContent=formatTopicDuration(topic.seconds);
        heading.append(title,total);
        const track=document.createElement('div'); track.className='topic-time-track';
        track.setAttribute('role','progressbar'); track.setAttribute('aria-valuemin','0');
        track.setAttribute('aria-valuemax',String(Math.round(max)));
        track.setAttribute('aria-valuenow',String(Math.round(topic.seconds)));
        track.setAttribute('aria-label',`${topic.name}: ${formatTopicDuration(topic.seconds)} total recorded time`);
        const fill=document.createElement('div'); fill.className='topic-time-fill';
        fill.style.width=`${topic.seconds/max*100}%`; track.append(fill);
        const note=document.createElement('p'); note.className='topic-time-note';
        note.textContent=`${topic.students.size} student${topic.students.size===1?'':'s'} with time records · Average ${formatTopicDuration(topic.seconds/topic.students.size)} per student`;
        item.append(heading,track,note);list.append(item);
    });
}
function initLeaderboardDropdown() {
    const select=document.getElementById('leaderboard-section-select'); if(!select)return;
    const previous=select.value;
    select.replaceChildren();
    const all=document.createElement('option');all.value='';all.textContent='All My Sections';select.append(all);
    [...new Set(mySections)].forEach(section=>{
        const opt=document.createElement('option');opt.value=section;opt.textContent=section;select.append(opt);
    });
    if ([...select.options].some(option=>option.value===previous))select.value=previous;
    select.onchange=()=>updateLeaderboard(select.value);
}

function updateMasteryDistributionList(students) {
    const listContainer = document.getElementById("mastery-distribution-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";
    const topicStats = {};

    students.forEach(student => {
        const subContent = student["Subject Content"] || student.subjectContent;

        if (subContent && typeof subContent === "object") {
            Object.keys(subContent).forEach(mainCategory => {
                const categoryData = subContent[mainCategory];
                if (categoryData && typeof categoryData === "object") {
                    Object.keys(categoryData).forEach(subTopic => {
                        const topicKey = `${mainCategory} › ${subTopic}`;
                        if (!topicStats[topicKey]) {
                            topicStats[topicKey] = { totalScore: 0, count: 0 };
                        }
                        const scoreVal = extractNumericMetrics(categoryData[subTopic]) || 3;
                        topicStats[topicKey].totalScore += scoreVal;
                        topicStats[topicKey].count += 1;
                    });
                }
            });
        }
    });

    const rankedTopics = Object.keys(topicStats).map(key => {
        const stats = topicStats[key];
        const avg = stats.count > 0 ? stats.totalScore / stats.count : 0;
        return { name: key, average: Math.round(avg) };
    });

    rankedTopics.sort((a, b) => b.average - a.average);

    if (rankedTopics.length === 0) {
        listContainer.innerHTML = `
            <li class="leaderboard-item empty-state">
                <span>No topic difficulty data available</span>
            </li>
        `;
        return;
    }

    const maxScore = Math.max(...rankedTopics.map(t => t.average), 1);

    rankedTopics.forEach(topic => {
        const percentage = Math.min(Math.round((topic.average / maxScore) * 100), 100);
        const li = document.createElement("li");
        li.className = "leaderboard-item";
        li.style.flexDirection = "column";
        li.style.alignItems = "stretch";
        li.style.gap = "6px";
        
        li.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">${topic.name}</span>
                <span style="font-family: 'Fira Code', monospace; font-weight: 700; color: var(--stat-icon);">${topic.average}</span>
            </div>
            <div style="width: 100%; background: var(--border); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${percentage}%; background: var(--stat-icon); height: 100%; border-radius: 3px;"></div>
            </div>
        `;
        listContainer.appendChild(li);
    });
}

// ----------------------------
// 4. UI EVENT LISTENERS
// ----------------------------
document.getElementById("section-select")?.addEventListener("change", (e) => {
    renderAnalytics(e.target.value);
});

window.logoutUser = async () => {
    stopTeacherListeners();
    try {
        await signOut(auth);
        window.location.href = '../index.html'; 
    } catch (error) {
        console.error("Logout error", error);
    }
};

window.closeLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "none";
};

window.showLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "flex";
};