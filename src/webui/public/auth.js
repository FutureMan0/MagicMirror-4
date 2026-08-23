// Anmeldung der Web-UI.
//
// Ablauf: Am Handy "Koppeln" antippen -> der Spiegel zeigt 60 Sekunden lang
// einen QR-Code -> scannen (oder den achtstelligen Code abtippen). Der Code
// wird nie über HTTP ausgeliefert; wer ihn kennt, stand vor dem Spiegel.
(function () {
  const state = { checked: false, required: true, authenticated: false };
  let overlay = null;

  // --- Netzwerk ------------------------------------------------------------

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // Jede 401-Antwort blendet die Anmeldung wieder ein - egal welcher Aufruf
  // sie ausgelöst hat.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const response = await originalFetch(input, { credentials: 'same-origin', ...init });

    const url = typeof input === 'string' ? input : input?.url || '';
    if (response.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
      state.authenticated = false;
      showOverlay();
    }

    return response;
  };

  // --- Oberfläche ----------------------------------------------------------

  function buildOverlay() {
    const root = document.createElement('div');
    root.className = 'auth-overlay';
    root.innerHTML = `
      <div class="auth-card">
        <h2>Spiegel koppeln</h2>
        <p class="auth-intro">
          Damit nicht jeder im WLAN deine Einstellungen ändern kann, muss dieses
          Gerät einmal gekoppelt werden.
        </p>

        <div class="auth-step" id="auth-step-start">
          <button class="btn-primary" id="auth-start-btn">Kopplung am Spiegel starten</button>
          <small>Der Spiegel zeigt dann 60 Sekunden lang einen QR-Code.</small>
        </div>

        <div class="auth-step" id="auth-step-code" style="display: none;">
          <label for="auth-code-input">Code vom Spiegel</label>
          <input type="text" id="auth-code-input" inputmode="latin" autocapitalize="characters"
                 autocomplete="off" spellcheck="false" maxlength="11" placeholder="ABCD EFGH">
          <button class="btn-primary" id="auth-claim-btn">Koppeln</button>
          <small id="auth-countdown"></small>
        </div>

        <div class="auth-error" id="auth-error" style="display: none;"></div>

        <details class="auth-fallback">
          <summary>Stattdessen mit Token anmelden</summary>
          <p>Das Token steht als <code>MM_ADMIN_TOKEN</code> in der Datei <code>.env</code> auf dem Pi.</p>
          <input type="password" id="auth-token-input" autocomplete="off" placeholder="MM_ADMIN_TOKEN">
          <button class="btn-secondary" id="auth-token-btn">Anmelden</button>
        </details>
      </div>
    `;
    return root;
  }

  function showError(message) {
    const box = overlay.querySelector('#auth-error');
    box.textContent = message;
    box.style.display = 'block';
  }

  function clearError() {
    const box = overlay.querySelector('#auth-error');
    box.textContent = '';
    box.style.display = 'none';
  }

  function startCountdown(expiresAt) {
    const label = overlay.querySelector('#auth-countdown');
    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      label.textContent = secondsLeft > 0
        ? `Code gültig noch ${secondsLeft} s`
        : 'Code abgelaufen - Kopplung neu starten.';
      if (secondsLeft === 0) clearInterval(timer);
    };
    const timer = setInterval(tick, 1000);
    tick();
  }

  async function claim(code) {
    clearError();
    try {
      await api('/api/auth/pair/claim', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      finish();
    } catch (error) {
      showError(error.message);
    }
  }

  function wireOverlay() {
    overlay.querySelector('#auth-start-btn').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      clearError();
      try {
        const result = await api('/api/auth/pair/start', { method: 'POST' });
        overlay.querySelector('#auth-step-start').style.display = 'none';
        overlay.querySelector('#auth-step-code').style.display = 'block';
        overlay.querySelector('#auth-code-input').focus();
        startCountdown(result.expiresAt);
      } catch (error) {
        showError(error.message);
      } finally {
        button.disabled = false;
      }
    });

    const codeInput = overlay.querySelector('#auth-code-input');
    codeInput.addEventListener('input', () => {
      // In Vierergruppen anzeigen - so wie der Spiegel ihn darstellt.
      const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      codeInput.value = raw.replace(/(.{4})(?=.)/g, '$1 ');
    });
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') claim(codeInput.value);
    });

    overlay.querySelector('#auth-claim-btn').addEventListener('click', () => {
      claim(codeInput.value);
    });

    overlay.querySelector('#auth-token-btn').addEventListener('click', async () => {
      clearError();
      try {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ token: overlay.querySelector('#auth-token-input').value.trim() })
        });
        finish();
      } catch (error) {
        showError(error.message);
      }
    });
  }

  function showOverlay() {
    if (overlay) {
      overlay.style.display = 'flex';
      return;
    }
    overlay = buildOverlay();
    document.body.appendChild(overlay);
    wireOverlay();
  }

  function finish() {
    state.authenticated = true;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    // Sauberer Neustart: alle Ansichten laden mit gültiger Session neu.
    const url = new URL(window.location.href);
    url.searchParams.delete('pair');
    window.location.replace(url.toString());
  }

  // --- Start ---------------------------------------------------------------

  async function init() {
    let status;
    try {
      status = await api('/api/auth/status');
    } catch (error) {
      console.error('Anmeldestatus konnte nicht geprüft werden:', error);
      return;
    }

    state.checked = true;
    state.required = status.authRequired;
    state.authenticated = status.authenticated;

    // Aus dem QR-Code gescannt: Code steht in der Adresse.
    const scanned = new URLSearchParams(window.location.search).get('pair');

    if (status.authenticated) {
      if (scanned) {
        const url = new URL(window.location.href);
        url.searchParams.delete('pair');
        window.history.replaceState({}, '', url.toString());
      }
      return;
    }

    showOverlay();
    if (scanned) {
      overlay.querySelector('#auth-step-start').style.display = 'none';
      overlay.querySelector('#auth-step-code').style.display = 'block';
      await claim(scanned);
    }
  }

  window.mm4Auth = { init, isAuthenticated: () => state.authenticated };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
