// "How is this computed?" explanations for every number on the teacher and Super Admin views.
// Each entry describes what record-analysis.js really does with the game's records, so change the
// text here whenever a calculation there changes. Display only: this module never touches Firestore.

const SECTIONS = [['what', 'What it means'], ['how', 'How it is computed'], ['example', 'Example'], ['read', 'What to look for']];

export const METRIC_HELP = {
    // ---------- Class Overview ----------
    students: {
        title: 'Students',
        what: 'How many students are in this view, and how many have started the game.',
        how: 'Count the names on the class list. "Started" means the game saved at least one record for them.',
        example: '30 on the list, 24 with records: 6 not started.',
        read: 'If few started, the numbers below describe only part of the class.'
    },
    'levels-avg': {
        title: 'Levels completed',
        what: 'How many of the 19 levels a student has finished, on average.',
        how: 'Levels finished by everyone ÷ all students, including those who have not started. Replaying a level counts once.',
        example: '(6 + 4 + 0) ÷ 3 students = 3.33, shown as 3.',
        read: 'An average can hide big gaps. Check the chart below.'
    },
    'time-total': {
        title: 'Time recorded',
        what: 'Total game time saved for this group, plus the average per student.',
        how: 'Add the saved time of every attempt, including unfinished ones.\nAverage = total ÷ students who started.',
        example: '5 + 3 + 2 = 10 min.\n10 min ÷ 3 students = about 3 min 20 s.',
        read: 'More time can mean difficulty or retries.'
    },
    'wrong-total': {
        title: 'Wrong submissions',
        what: 'How many wrong answers the game counted for this group.',
        how: 'Add the wrong answers from every task in every attempt.\nAverage = total ÷ students who started.',
        example: '7 + 2 + 3 = 12 wrong.\n12 ÷ 3 students = 4 per student.',
        read: 'Retries also add to this total.'
    },
    'level-chart': {
        title: 'Level completion',
        what: 'How many students finished each of the 19 levels.',
        how: 'For each level, count the students the game marked as finished. Select a bar for the percentage.',
        example: '8 of 12 finished Level 2: the bar shows 8, and 8 ÷ 12 = 67%.',
        read: 'A sharp drop shows where students stopped, or a level still locked.'
    },
    'hl-time': {
        title: 'Most time spent',
        what: 'The topic with the highest average time per student.',
        how: 'For each topic: total time ÷ students who played it. The highest result is shown.',
        example: 'Loops: 30 min ÷ 5 = 6 min.\nArrays: 20 min ÷ 2 = 10 min. Arrays is shown.',
        read: 'A small group can change the average a lot.'
    },
    'hl-error': {
        title: 'Most wrong submissions',
        what: 'The topic with the most wrong answers per student, on average.',
        how: 'For each topic: total wrong answers ÷ students who played it. The highest result is shown.',
        example: 'Loops: 20 ÷ 5 = 4.\nArrays: 12 ÷ 2 = 6. Arrays is shown.',
        read: 'A good topic to review with the class.'
    },
    'hl-people': {
        title: 'Most students with errors',
        what: 'The topic where the most students made at least one mistake.',
        how: 'For each topic, count the students with 1 or more wrong answers. Each student counts once.',
        example: 'Loops: 7 of 9 students.\nArrays: 4 of 4 students. Loops is shown because 7 is higher.',
        read: 'This shows how widespread a problem is.'
    },
    'topic-time': {
        title: 'Time spent per topic',
        what: 'The average time per student for each topic, longest first.',
        how: 'Total time on the topic ÷ students who played it. Every attempt counts, so retries make the bar longer.',
        example: '(4 + 2 + 3 min) ÷ 3 students = 3 min per student.',
        read: 'Compare bar lengths. Select a bar to see the total behind it.'
    },
    'topic-wrong': {
        title: 'Errors per topic',
        what: 'The average wrong answers per student for each topic, highest first.',
        how: 'Total wrong answers in the topic ÷ students who played it, rounded. "<1" means above 0 but below 1.',
        example: '14 wrong ÷ 4 students = 3.5, shown as 4.',
        read: 'A long bar means students often answered that topic incorrectly.'
    },
    'topic-table': {
        title: 'Numbers per topic',
        what: 'The numbers behind the two charts above, in level order.',
        how: 'Average = total ÷ students who played the topic. The total is shown under each average.',
        example: '12 min and 8 wrong from 4 students: average 3 min and 2 wrong.',
        read: 'An average from 2 students says less than one from 30.'
    },
    tasks: {
        title: 'Tasks with the most wrong submissions',
        what: 'The coding tasks with the most wrong answers (top 8).',
        how: 'Add each task\'s wrong answers across all students and attempts. "Students" counts everyone who has a record for the task.',
        example: 'Ana 3 + Ben 1 + Carla 0 = 4 wrong, from 3 students.',
        read: 'This points to the exact exercise to review.'
    },
    messages: {
        title: 'Most common error messages',
        what: 'The messages the game showed most when an answer was wrong (top 6).',
        how: 'Count how many times each exact message was saved in each topic. Different wording counts separately.',
        example: '"Float must end with f!" saved 5 times shows as "5 times".',
        read: 'The wording shows which misunderstanding to address. Counts can differ from wrong-submission totals.'
    },
    recent: {
        title: 'Recent activity',
        what: 'The 8 latest saved attempts, newest first.',
        how: 'Sort dated attempts by date. Each row shows that one attempt, not a total.',
        example: 'Ana at 10:05 is listed above Ben at 9:50.',
        read: 'Use this to confirm students are playing. Open a student on the Students page for their full history.'
    },
    'not-started': {
        title: 'Not started yet',
        what: 'Students with no game records so far.',
        how: 'Class list − students with at least one saved game record.',
        example: '30 on the list − 24 with records = 6 listed.',
        read: 'Follow up in case they cannot sign in or have no device.'
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
        how: 'Count the students with at least one saved game record.',
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
        how: 'Count the different levels the game marked as finished. Replays count once.',
        example: 'Levels 1, 2, 3 and 5 finished: 4 of 19.',
        read: 'This counts finished levels, not how well the student understands C#.'
    },
    'col-time': {
        title: 'Time recorded',
        what: 'The total game time saved for this student.',
        how: 'Add the time of every attempt in every topic, including unfinished attempts.',
        example: '4 + 3 + 5 min = 12 min.',
        read: 'Much time on few levels may mean the student needs support.'
    },
    'col-wrong': {
        title: 'Wrong submissions',
        what: 'The total wrong answers the game counted for this student.',
        how: 'Add the wrong answers from every task in every attempt.',
        example: '3 + 1 + 2 = 6.',
        read: 'Open Details to see whether the count falls on later attempts.'
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
        how: 'Count the saved attempts in every topic.',
        example: 'Loops 3 + Arrays 1 = 4.',
        read: 'More attempts than levels means the student retried some levels.'
    },
    's-topic-time': {
        title: 'Time spent per topic',
        what: 'This student\'s total time on each topic, longest first.',
        how: 'Add the time of all their attempts in the topic. Nothing is averaged.',
        example: '4 min + 3 min = 7 min.',
        read: 'See Attempt history for the time of each try.'
    },
    's-topic-wrong': {
        title: 'Errors per topic',
        what: 'This student\'s total wrong answers on each topic, highest first.',
        how: 'Add the wrong answers of all their attempts in the topic. Nothing is averaged.',
        example: '3 + 1 = 4.',
        read: 'Open Attempt history to read the exact error messages.'
    },
    's-progress': {
        title: 'Attempt progress',
        what: 'Whether the student improved on levels played more than once.',
        how: 'Compare the first and latest attempt. "Faster" means less time; "fewer wrong" means fewer wrong answers.',
        example: 'First try 5 min and 4 wrong, latest 3 min and 1 wrong: counts as both.',
        read: 'A line going down shows improvement. This compares the student only with themselves.'
    },
    's-history': {
        title: 'Attempt history',
        what: 'Every saved attempt of this student, by topic.',
        how: 'Longer bar = more time, within that topic. One dot = one wrong answer. Check mark = completed.',
        example: 'Attempts of 4 min and 2 min: the second bar is half as long.',
        read: 'Open an attempt to see each task and its error messages.'
    },
    's-messages': {
        title: 'Most common errors',
        what: 'The messages this student saw most (top 6).',
        how: 'Count how many times each exact message was saved across all their attempts.',
        example: 'Saved twice in Attempt 1 and once in Attempt 2: "3 times".',
        read: 'A repeating message points to a specific habit to discuss.'
    },

    // ---------- Levels page ----------
    'levels-page': {
        title: 'Level completion',
        what: 'The share of students in this section who finished each level.',
        how: 'Students who finished ÷ all students in the section × 100, rounded.',
        example: '18 ÷ 24 × 100 = 75%.',
        read: 'Use it to decide when to generate the next level\'s code.'
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
