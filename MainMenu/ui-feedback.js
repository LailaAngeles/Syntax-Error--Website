// Shared waiting and result feedback for the teacher and Super Admin pages. Display only.

// Runs an action with its button locked and showing a spinner, so it cannot be clicked twice.
export async function withBusy(button, label, action) {
    if (button?.dataset.busy) return undefined;
    const original = button?.innerHTML;
    if (button) {
        button.dataset.busy = '1';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = `<span class="da-spinner da-spinner-sm" aria-hidden="true"></span> ${label}`;
    }
    try {
        return await action();
    } finally {
        if (button) {
            delete button.dataset.busy;
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = original;
        }
    }
}

// A short message in the corner; errors stay longer and are announced straight away.
export function toast(message, kind = 'success') {
    let holder = document.getElementById('da-toasts');
    if (!holder) {
        holder = document.createElement('div');
        holder.id = 'da-toasts';
        document.body.append(holder);
    }
    const item = document.createElement('div');
    item.className = `da-toast da-toast-${kind}`;
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = document.createElement('i');
    icon.className = `bi ${kind === 'error' ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill'}`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    item.append(icon, text);
    holder.append(item);
    setTimeout(() => item.remove(), kind === 'error' ? 8000 : 4000);
}

// Fills one area with a spinner and a message, leaving the rest of the page usable.
export function showLoading(element, message = 'Loading...') {
    if (!element) return;
    element.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'da-loading';
    box.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'da-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    box.append(spinner, text);
    element.append(box);
}

// The same area when the data could not be read. Never leaves a spinner running.
export function showLoadError(element, message = 'This could not be loaded. Check your connection and refresh the page.') {
    if (!element) return;
    element.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'da-loading da-loading-error';
    box.setAttribute('role', 'alert');
    const icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle-fill';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    box.append(icon, text);
    element.append(box);
}
