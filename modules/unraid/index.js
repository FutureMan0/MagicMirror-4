// Unraid-Anzeige.
//
// Der Aufbau folgt dem versionsabhängigen Schema: fehlt ein Abschnitt, fehlt
// genau er - und wird auch als fehlend benannt, statt einfach zu verschwinden.
var UnraidBase = (typeof window !== 'undefined' && window.DataModule) || class {};

class UnraidModule extends UnraidBase {
  static moduleName = 'unraid';
  static patchable = ['maxDisks', 'warnTemp', 'showSystem', 'showArray', 'showDocker', 'showVms'];

  constructor(config = {}) {
    super(config);

    this.config = {
      maxDisks: config.maxDisks || 8,
      warnTemp: config.warnTemp || 45,
      language: config.language || 'de',
      ...config
    };
  }

  get title() {
    return 'Unraid';
  }

  renderData(data, root) {
    root.textContent = '';

    if (data.system) root.appendChild(this.renderSystem(data.system));
    if (data.array) root.appendChild(this.renderArray(data.array));
    if (data.docker || data.vms) root.appendChild(this.renderCounts(data));

    // Fehlende Abschnitte benennen statt weglassen: sonst hält man einen
    // Ausfall für "gibt es hier nicht".
    if (data.unavailable && data.unavailable.length > 0) {
      const notice = document.createElement('div');
      notice.className = 'dm-status dm-status-stale';
      notice.textContent = `Nicht verfügbar: ${data.unavailable.map(u => u.section).join(', ')}`;
      root.appendChild(notice);
    }
  }

  renderSystem(system) {
    const box = document.createElement('div');
    box.className = 'unraid-section';

    if (system.cpuPercent !== null) {
      box.appendChild(this.renderMeter('CPU', system.cpuPercent, `${Math.round(system.cpuPercent)} %`));
    }

    if (system.memoryPercent !== null) {
      const label = system.memoryUsedGb && system.memoryTotalGb
        ? `${system.memoryUsedGb.toFixed(1)} / ${system.memoryTotalGb.toFixed(0)} GB`
        : `${Math.round(system.memoryPercent)} %`;
      box.appendChild(this.renderMeter('RAM', system.memoryPercent, label));
    }

    return box;
  }

  renderArray(array) {
    const box = document.createElement('div');
    box.className = 'unraid-section';

    const header = document.createElement('div');
    header.className = 'dm-row';

    const label = document.createElement('span');
    label.className = 'dm-row-label';
    label.textContent = 'Array';
    header.appendChild(label);

    const state = document.createElement('span');
    state.className = 'dm-pill';
    state.dataset.tone = String(array.state).toUpperCase() === 'STARTED' ? 'ok' : 'warn';
    state.textContent = array.state;
    header.appendChild(state);

    box.appendChild(header);

    if (array.percent !== null) {
      const label2 = array.usedGb && array.totalGb
        ? `${(array.usedGb / 1024).toFixed(1)} / ${(array.totalGb / 1024).toFixed(1)} TB`
        : `${Math.round(array.percent)} %`;
      box.appendChild(this.renderMeter('Belegt', array.percent, label2));
    }

    if (array.parity && array.parity.status && String(array.parity.status).toUpperCase() !== 'IDLE') {
      const parity = document.createElement('div');
      parity.className = 'dm-row';
      parity.appendChild(this.buildLabel('Parity'));

      const value = document.createElement('span');
      value.className = 'dm-row-value';
      value.textContent = array.parity.progress !== null && array.parity.progress !== undefined
        ? `${array.parity.status} ${Math.round(array.parity.progress)} %`
        : String(array.parity.status);
      parity.appendChild(value);

      box.appendChild(parity);
    }

    if (array.disks.length > 0) {
      const disks = document.createElement('div');
      disks.className = 'unraid-disks';

      for (const disk of array.disks) {
        const pill = document.createElement('span');
        pill.className = 'dm-pill unraid-disk';

        if (disk.temp === null) {
          // Schlafende Platten melden keine Temperatur - das ist kein Fehler.
          pill.textContent = `${disk.name} · –`;
        } else {
          pill.textContent = `${disk.name} · ${disk.temp} °C`;
          if (disk.temp >= this.config.warnTemp) pill.dataset.tone = 'warn';
          if (disk.temp >= this.config.warnTemp + 10) pill.dataset.tone = 'danger';
        }

        disks.appendChild(pill);
      }

      box.appendChild(disks);
    }

    return box;
  }

  renderCounts(data) {
    const box = document.createElement('div');
    box.className = 'unraid-section';

    if (data.docker) {
      box.appendChild(this.renderCountRow('Docker', data.docker.running, data.docker.total));
    }

    if (data.vms) {
      box.appendChild(this.renderCountRow('VMs', data.vms.running, data.vms.total));
    }

    return box;
  }

  renderCountRow(label, running, total) {
    const row = document.createElement('div');
    row.className = 'dm-row';
    row.appendChild(this.buildLabel(label));

    const value = document.createElement('span');
    value.className = 'dm-row-value';
    value.textContent = `${running} / ${total} laufen`;
    row.appendChild(value);

    return row;
  }

  renderMeter(label, percent, valueText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'unraid-meter';

    const row = document.createElement('div');
    row.className = 'dm-row';
    row.appendChild(this.buildLabel(label));

    const value = document.createElement('span');
    value.className = 'dm-row-value';
    value.textContent = valueText;
    row.appendChild(value);

    wrapper.appendChild(row);

    const bar = document.createElement('div');
    bar.className = 'dm-bar';

    const fill = document.createElement('div');
    fill.className = 'dm-bar-fill';
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (percent >= 90) fill.dataset.level = 'critical';
    else if (percent >= 75) fill.dataset.level = 'warn';
    bar.appendChild(fill);

    wrapper.appendChild(bar);
    return wrapper;
  }

  buildLabel(text) {
    const label = document.createElement('span');
    label.className = 'dm-row-label';
    label.textContent = text;
    return label;
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.unraid = UnraidModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnraidModule;
}
