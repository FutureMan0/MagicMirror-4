// AEON on the mirror: the orb, what AEON last said in the house, the day ahead.
var AeonBase = (typeof window !== 'undefined' && window.DataModule) || class {};

class AeonModule extends AeonBase {
  static moduleName = 'aeon';
  static patchable = ['showOrb'];

  renderData(data, root) {
    root.textContent = '';

    if (this.config.showOrb !== false) {
      const orb = document.createElement('div');
      orb.className = 'aeon-orb';
      orb.setAttribute('aria-hidden', 'true');
      root.appendChild(orb);
    }

    if (data.said && data.said.length > 0) {
      const said = document.createElement('div');
      said.className = 'aeon-said';
      for (const line of data.said) {
        const row = document.createElement('div');
        row.className = 'aeon-line';
        const at = document.createElement('span');
        at.className = 'aeon-at';
        at.textContent = line.at;
        const text = document.createElement('span');
        text.textContent = line.text;
        row.append(at, text);
        said.appendChild(row);
      }
      root.appendChild(said);
    }

    if (data.entries && data.entries.length > 0) {
      const list = document.createElement('div');
      list.className = 'aeon-agenda';
      for (const entry of data.entries) {
        const row = document.createElement('div');
        row.className = 'dm-row';
        const when = document.createElement('span');
        when.className = 'dm-row-label aeon-at';
        when.textContent = entry.at ? `${entry.day === 'heute' ? '' : `${entry.day} `}${entry.at}` : entry.day;
        const title = document.createElement('span');
        title.textContent = entry.title;
        row.append(when, title);
        list.appendChild(row);
      }
      root.appendChild(list);
    } else if (data.calendar) {
      const none = document.createElement('div');
      none.className = 'aeon-quiet';
      none.textContent = 'Heute steht nichts an.';
      root.appendChild(none);
    }
  }
}

if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.aeon = AeonModule;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AeonModule;
}
