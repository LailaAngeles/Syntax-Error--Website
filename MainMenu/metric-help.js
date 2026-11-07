// "How is this computed?" explanations for every number on the teacher and Super Admin views.
// Each entry describes what record-analysis.js really does with the game's records, so change the
// text here whenever a calculation there changes. Display only: this module never touches Firestore.

const SECTIONS = [['what', 'What it means'], ['how', 'How it is computed'], ['example', 'Example'], ['read', 'What to look for']];

export const METRIC_HELP = {
    // ---------- Class Overview ----------
    students: {
        title: 'Students',
        what: 'How many students are in this view, and how many have started the game.',
        how: "Count the names on the class list. \"Started\" means a saved attempt or a finished level.",
        example: '30 on the list, 24 with records: 6 not started.',
        read: 'If few started, the numbers below describe only part of the class.'
    },
    'levels-avg': {
        title: 'Levels completed',
        what: 'How many of the 19 levels a student has finished, on average.',
        how: "Levels finished by everyone ÷ all students, including those not started. Replays count once.",
        example: '(6 + 4 + 0) ÷ 3 students = 3.33, shown as 3.',
        read: 'An average can hide big gaps. Check the chart below.'
    },
    'time-total': {
        title: 'Time recorded',
        what: 'Total game time saved for this group, plus the average per student.',
        how: "Add the saved time of every attempt, latest and earlier.\nAverage = total ÷ students who started.",
        example: '5 + 3 + 2 = 10 min.\n10 min ÷ 3 students = about 3 min 20 s.',
        read: 'More time can mean difficulty or retries.'
    },
    'wrong-total': {
        title: 'Incorrect submissions',
        what: 'How many incorrect submissions the game counted for this group.',
        how: "Add the incorrect submissions from every attempt, latest and earlier.\nAverage = total ÷ students who started.",
        example: "7 + 2 + 3 = 12 incorrect.\n12 ÷ 3 students = 4 per student.",
        read: 'Retries also add to this total.'
    },
    'level-chart': {
        title: "Level completion",
        what: "How many students genuinely finished each of the 19 levels.",
        how: "Count students the game marked as finished. Opening a level or having a code does not count.",
        example: "8 of 12 finished Level 2: the bar shows 8, and 8 ÷ 12 = 67%.",
        read: "A low bar may mean the level is locked. See the table."
    },
    'hl-time': {
        title: 'Most time spent',
        what: 'The topic with the highest average time per student.',
        how: "Each topic's total time ÷ students who played it. Highest shown. Follows the attempts switch.",
        example: 'Loops: 30 min ÷ 5 = 6 min.\nArrays: 20 min ÷ 2 = 10 min. Arrays is shown.',
        read: 'A small group can change the average a lot.'
    },
    'hl-error': {
        title: 'Most incorrect submissions',
        what: 'The topic with the most incorrect submissions per student, on average.',
        how: "Each topic's incorrect submissions ÷ students who played it. Highest shown. Follows the attempts switch.",
        example: 'Loops: 20 ÷ 5 = 4.\nArrays: 12 ÷ 2 = 6. Arrays is shown.',
        read: 'A good topic to review with the class.'
    },
    'hl-people': {
        title: 'Most students with errors',
        what: 'The topic where the most students made at least one mistake.',
        how: "Count students with 1 or more incorrect submissions in the topic. Follows the attempts switch.",
        example: 'Loops: 7 of 9 students.\nArrays: 4 of 4 students. Loops is shown because 7 is higher.',
        read: 'This shows how widespread a problem is.'
    },
    'topic-time': {
        title: "Time spent per topic",
        what: "The average time per student for each topic, longest first.",
        how: "Latest attempt: each student's newest try with a saved result. All attempts: every try added up. Divide by students who played.",
        example: "Latest tries of 4, 2 and 3 min: (4 + 2 + 3) ÷ 3 = 3 min.",
        read: "All attempts grows with every replay."
    },
    'topic-wrong': {
        title: "Errors per topic",
        what: "The average incorrect submissions per student for each topic, highest first.",
        how: "Latest attempt: the newest try with a saved result. All attempts: every try added up. Divide by students who played, then round.",
        example: "14 incorrect ÷ 4 students = 3.5, shown as 4.",
        read: "\"<1\" means above 0 but below 1."
    },
    'topic-table': {
        title: "Numbers per topic",
        what: "The numbers behind the two charts, in level order.",
        how: "Latest attempt averages each student's newest try with a saved result. All attempts averages everything recorded. Both divide by the students who played.",
        example: "4 students, latest tries totalling 12 min: average 3 min.",
        read: "An average from 2 students says less than one from 30."
    },
    tasks: {
        title: 'Tasks with the most incorrect submissions',
        what: 'The coding tasks with the most incorrect submissions (top 8).',
        how: 'Add each task\'s incorrect submissions across all students and attempts. "Students" counts everyone who has a record for the task.',
        example: "Ana 3 + Ben 1 + Carla 0 = 4 incorrect, from 3 students.",
        read: 'This points to the exact exercise to review.'
    },
    recent: {
        title: 'Recent activity',
        what: 'The 8 latest saved attempts, newest first.',
        how: "Sort dated attempts, newest first. Each row is one attempt, not a total. \"In progress\" means opened with nothing saved yet.",
        example: 'Ana at 10:05 is listed above Ben at 9:50.',
        read: 'Use this to confirm students are playing. Open a student on the Students page for their full history.'
    },
    'not-started': {
        title: 'Not started yet',
        what: 'Students with no game records so far.',
        how: "Class list − students with a saved attempt or a finished level.",
        example: '30 on the list − 24 with records = 6 listed.',
        read: 'Follow up in case they cannot sign in or have no device.'
    },

    'level-access': {
        title: 'Who can play each level',
        what: "Where students stand on each level, so locked levels are not missed work.",
        how: "Waiting for code: finished the previous level. Unlocked: code accepted, no attempt saved. Started: attempt saved, unfinished. Last column: completed ÷ students with access.",
        example: "6 completed of 10 with access: 60%.",
        read: "Many waiting may mean it is time for that code."
    },

    // ---------- Students page ----------
    online: {
        title: 'Online',
        what: 'How many students the game reports as online now.',
        how: 'Count the students whose online flag from the game is on. The website does not check it further.',
        example: 'Flag on for 5 of 30 students: the box shows 5.',
        read: 'The flag can stay on if the game closed suddenly, so also check Last activity.'
    },
    started: {
        title: 'Started playing',
        what: 'How many students in this view have begun the game.',
        how: "Count the students with a saved attempt or a finished level.",
        example: '24 of 30 students have records: the box shows 24.',
        read: 'Started playing + Not started always equals Students.'
    },
    'not-started-count': {
        title: 'Not started',
        what: 'How many students have no game records yet.',
        how: 'Students − Started playing.',
        example: '30 − 24 = 6.',
        read: 'Choose "Not started" in the Show menu to see their names.'
    },
    'col-levels': {
        title: 'Levels completed',
        what: 'How many of the 19 levels this student has finished.',
        how: "Count the different levels the game marked as finished. Replays count once. Opening a level or having its code does not count.",
        example: 'Levels 1, 2, 3 and 5 finished: 4 of 19.',
        read: 'This counts finished levels, not how well the student understands C#.'
    },
    'col-time': {
        title: "Total time",
        what: "All game time saved for this student.",
        how: "Add the time of every attempt in every topic. Details separates the latest attempt.",
        example: "4 + 3 + 5 min = 12 min.",
        read: "This grows with every replay, so it does not show current speed."
    },
    'col-wrong': {
        title: "Total incorrect submissions",
        what: "Every incorrect submission the game counted for this student.",
        how: "Add the count from every attempt. One attempt can contain several incorrect submissions.",
        example: "3 + 1 + 2 = 6.",
        read: "Open Details to see whether the count falls on later attempts."
    },
    'col-last': {
        title: 'Last activity',
        what: 'The latest date found in this student\'s game record.',
        how: 'Take the newest of the student\'s last-seen date and their attempt dates.',
        example: 'Last attempt Nov 2, last seen Nov 3: shows Nov 3.',
        read: 'The best way to check whether a student has played recently.'
    },

    // ---------- One student (Details) ----------
    's-attempts': {
        title: 'Attempts',
        what: 'How many tries the game saved for this student, across all topics.',
        how: "Count the saved attempts in every topic, including any opened but not finished.",
        example: 'Loops 3 + Arrays 1 = 4.',
        read: 'More attempts than levels means the student retried some levels.'
    },
    's-topic-time': {
        title: "Time spent per topic",
        what: "This student's time on each topic, longest first.",
        how: "Latest attempt: the newest try with a saved result. All attempts: every try added up.",
        example: "Tries of 4 min then 3 min: latest 3 min, all attempts 7 min.",
        read: "See Attempt history for the time of each try."
    },
    's-topic-wrong': {
        title: "Errors per topic",
        what: "This student's incorrect submissions on each topic, highest first.",
        how: "Latest attempt: the newest try with a saved result. All attempts: every try added up.",
        example: "3 then 1 incorrect: latest 1, all attempts 4.",
        read: "A falling count shows improvement. Attempt history has the exact messages."
    },
    's-topic-table': {
        title: 'Latest, earlier and total',
        what: 'This student\'s most recent try beside their earlier tries and the overall total.',
        how: "Latest: the newest attempt with a saved result. Earlier: every other attempt. All attempts: both added together.",
        example: 'Latest 3 min + earlier 4 min = 7 min in all.',
        read: 'Old attempts are kept, never overwritten, so progress over time stays visible.'
    },
    's-progress': {
        title: 'Attempt progress',
        what: 'Whether the student improved on levels played more than once.',
        how: "Compare the first and latest attempts with a saved result. Attempts only opened are skipped.",
        example: "First try 5 min and 4 incorrect, latest 3 min and 1 incorrect: faster, and fewer incorrect.",
        read: 'A line going down shows improvement. This compares the student only with themselves.'
    },
    's-history': {
        title: 'Attempt history',
        what: 'Every saved attempt of this student, by topic.',
        how: "Longer bar = more time in that topic. One dot = one incorrect submission. Check mark = completed. \"In progress\" = nothing saved yet.",
        example: 'Attempts of 4 min and 2 min: the second bar is half as long.',
        read: 'Open an attempt to see its tasks and messages.'
    },

    // ---------- Levels page ----------
    'levels-page': {
        title: "Level completion",
        what: "The share of students in this section who finished each level.",
        how: "Students who finished ÷ all students in the section × 100, rounded. \"Waiting for code\" finished the previous level but have not unlocked this one.",
        example: "18 ÷ 24 × 100 = 75%.",
        read: "Use it to decide when to generate the next code."
    }
};

const escapeAttr = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small icon button placed beside a number or chart title.
export function infoButton(key) {
    const label = `How is this computed? ${METRIC_HELP[key]?.title ?? ''}`.trim();
    return `<button type="button" class="da-info" data-da-info="${key}" title="How is this computed?" aria-label="${escapeAttr(label)}"><i class="bi bi-info-circle" aria-hidden="true"></i></button>`;
}

// Labelled version for card headings.
export function helpLink(key) {
    return `<button type="button" class="da-help-link" data-da-info="${key}" aria-label="${escapeAttr(`How is this computed? ${METRIC_HELP[key]?.title ?? ''}`)}"><i class="bi bi-info-circle" aria-hidden="true"></i> How is this computed?</button>`;
}

// Keeps the current figures for the open view, so the popup can show them next to the example.
export function setLiveNumbers(root, numbers) {
    if (!root) return;
    root._daLive = numbers;
    root.setAttribute('data-da-live', '');
}

let dialog = null;
function helpDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'da-help';
    dialog.setAttribute('aria-labelledby', 'da-help-title');
    dialog.innerHTML = `<div class="da-help-box">
        <div class="da-help-head">
          <div><span class="da-eyebrow">HOW IS THIS COMPUTED?</span><h2 id="da-help-title"></h2></div>
          <button type="button" class="da-help-close" aria-label="Close explanation"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
        <div class="da-help-body"></div>
      </div>`;
    dialog.querySelector('.da-help-close').addEventListener('click', () => dialog.close());
    // A click on the dialog itself is a click on the backdrop around the box.
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    return dialog;
}

function helpSection(label, text, className = '') {
    const block = document.createElement('section');
    block.className = `da-help-part ${className}`.trim();
    const heading = document.createElement('h3');
    heading.textContent = label;
    const body = document.createElement('p');
    body.textContent = text;
    block.append(heading, body);
    return block;
}

export function openMetricHelp(key, live) {
    const help = METRIC_HELP[key];
    if (!help) return;
    const box = helpDialog();
    box.querySelector('#da-help-title').textContent = help.title;
    const body = box.querySelector('.da-help-body');
    body.replaceChildren();
    for (const [part, label] of SECTIONS) {
        body.append(helpSection(label, help[part], `da-help-${part}`));
        if (part === 'example' && live) body.append(helpSection('Your numbers right now', live, 'da-help-live'));
    }
    if (!box.open) box.showModal();
    body.scrollTop = 0;
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
        const button = event.target.closest?.('[data-da-info]');
        if (!button) return;
        const key = button.dataset.daInfo;
        openMetricHelp(key, button.closest('[data-da-live]')?._daLive?.[key]);
    });
}
