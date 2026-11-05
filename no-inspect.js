// Makes the browser's developer tools harder to reach: no right-click menu on
// the page, and the usual shortcuts do nothing. This only discourages casual
// use. Data is protected by Firebase sign-in and the Firestore security rules.
(function () {
    "use strict";

    function isEditable(target) {
        return !!(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));
    }

    // Right-click stays available in form fields so teachers can still paste.
    document.addEventListener("contextmenu", function (event) {
        if (!isEditable(event.target)) event.preventDefault();
    }, true);

    document.addEventListener("keydown", function (event) {
        var key = (event.key || "").toLowerCase();
        var mod = event.ctrlKey || event.metaKey;
        var blocked =
            key === "f12" ||
            (mod && (event.shiftKey || event.altKey) && ["i", "j", "c", "k"].indexOf(key) !== -1) ||
            (mod && !event.shiftKey && (key === "u" || key === "s")) ||
            (event.metaKey && event.altKey && key === "u");
        if (blocked) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
})();
