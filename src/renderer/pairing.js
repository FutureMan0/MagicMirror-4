// Anzeige des Kopplungscodes auf dem Spiegel.
//
// Der Code erscheint nur hier - nicht in der HTTP-Antwort. Damit ist der
// Nachweis "ich bin im Raum" an den physischen Zugang gebunden.
(function () {
  let overlay = null;
  let countdownTimer = null;

  function removeOverlay() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function show(data) {
    removeOverlay();

    overlay = document.createElement('div');
    overlay.className = 'pairing-overlay';

    const card = document.createElement('div');
    card.className = 'pairing-card';

    const title = document.createElement('div');
    title.className = 'pairing-title';
    title.textContent = 'Gerät koppeln';
    card.appendChild(title);

    if (data.svg) {
      const qr = document.createElement('div');
      qr.className = 'pairing-qr';
      // Der SVG-String kommt aus dem eigenen Hauptprozess (qrcode-Paket),
      // nicht von außen.
      qr.innerHTML = data.svg;
      card.appendChild(qr);
    }

    const code = document.createElement('div');
    code.className = 'pairing-code';
    // In Vierergruppen - so liest man ihn zuverlässig ab, wenn der QR-Code
    // nicht scannbar ist.
    code.textContent = String(data.code).replace(/(.{4})(?=.)/g, '$1 ');
    card.appendChild(code);

    const hint = document.createElement('div');
    hint.className = 'pairing-hint';
    hint.textContent = data.url;
    card.appendChild(hint);

    const countdown = document.createElement('div');
    countdown.className = 'pairing-countdown';
    card.appendChild(countdown);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000));
      countdown.textContent = `gültig noch ${secondsLeft} s`;
      if (secondsLeft === 0) removeOverlay();
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  if (window.electronAPI && window.electronAPI.onPairingStarted) {
    window.electronAPI.onPairingStarted(show);
    window.electronAPI.onPairingEnded(removeOverlay);
  }
})();
