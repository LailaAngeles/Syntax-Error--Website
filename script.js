
const btnAndroid = document.getElementById('btn-android');
const btnIos = document.getElementById('btn-ios');
const qrCardInner = document.getElementById('qr-card-inner');

if (btnAndroid && btnIos && qrCardInner) {

    function updateCardState(isIos) {
        if (isIos) {
            btnAndroid.classList.remove('active');
            btnIos.classList.add('active');
            qrCardInner.classList.add('flipped');
        } else {
            btnIos.classList.remove('active');
            btnAndroid.classList.add('active');
            qrCardInner.classList.remove('flipped');
        }
    }

    btnIos.addEventListener('click', () => updateCardState(true));
    btnAndroid.addEventListener('click', () => updateCardState(false));
}