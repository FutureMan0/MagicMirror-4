// Konfigurationsänderungen punktuell anwenden.
//
// Bisher lief jede Änderung über renderModules(): alle Module zerstören,
// Container leeren, alles neu aufbauen. Wer am Handy die Schriftgröße der Uhr
// verstellte, löste damit aus, dass das Wetter neu geladen und der Stundenplan
// neu abgefragt wurde - und für einen Moment stand der halbe Spiegel leer.
//
// Der Abgleich hier fasst nur an, was sich wirklich geändert hat.
//
// Voraussetzung dafür ist eine stabile Kennung je Modul-Eintrag. Über den
// Array-Index ginge es nicht: schiebt man ein Modul in der Liste nach oben,
// sähe das wie "alle ausgetauscht" aus.
(function () {
  /** Kennung eines Eintrags - bevorzugt die vergebene id. */
  function keyOf(entry, index) {
    return entry.id || `${entry.module}#${index}`;
  }

  function positionOf(entry) {
    return JSON.stringify(entry.position ?? null);
  }

  function configOf(entry) {
    return JSON.stringify(entry.config ?? {});
  }

  /** Welche Schlüssel unterscheiden sich zwischen zwei Konfigurationen? */
  function changedKeys(before = {}, after = {}) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  }

  /**
   * Vergleicht zwei Konfigurationen und sagt, was zu tun ist.
   *
   * Bewusst als reine Funktion: so lässt sich der Abgleich prüfen, ohne einen
   * Renderer zu starten - und genau hier stecken die Fehler, die man sonst
   * erst am Spiegel sieht.
   */
  function diff(previous, next) {
    const result = {
      theme: (previous?.theme || 'default') !== (next?.theme || 'default'),
      grid: JSON.stringify(previous?.gridSettings ?? null) !== JSON.stringify(next?.gridSettings ?? null),
      language: (previous?.language || 'en') !== (next?.language || 'en'),
      added: [],
      removed: [],
      moved: [],
      patched: [],
      rebuilt: [],
      unchanged: []
    };

    const before = new Map(
      (previous?.modules || []).map((entry, index) => [keyOf(entry, index), entry])
    );
    const after = new Map(
      (next?.modules || []).map((entry, index) => [keyOf(entry, index), entry])
    );

    for (const [key, entry] of after) {
      const old = before.get(key);

      // Ein- und Ausschalten zählt wie Hinzufügen und Entfernen: ein
      // abgeschaltetes Modul soll wirklich weg sein, nicht nur unsichtbar.
      const wasActive = old && old.enabled !== false;
      const isActive = entry.enabled !== false;

      if (!old || (!wasActive && isActive)) {
        if (isActive) result.added.push({ key, entry });
        continue;
      }

      if (wasActive && !isActive) {
        result.removed.push({ key, entry: old });
        continue;
      }

      if (!isActive) continue;

      const moved = positionOf(old) !== positionOf(entry);
      const configChanged = configOf(old) !== configOf(entry);

      if (configChanged) {
        result.patched.push({
          key,
          entry,
          previousEntry: old,
          changed: changedKeys(old.config, entry.config),
          moved
        });
      } else if (moved) {
        result.moved.push({ key, entry });
      } else {
        result.unchanged.push({ key, entry });
      }
    }

    for (const [key, entry] of before) {
      if (!after.has(key) && entry.enabled !== false) {
        result.removed.push({ key, entry });
      }
    }

    return result;
  }

  /** Gibt es überhaupt etwas zu tun? */
  function isEmpty(d) {
    return !d.theme && !d.grid && !d.language
      && d.added.length === 0 && d.removed.length === 0
      && d.moved.length === 0 && d.patched.length === 0;
  }

  /**
   * Ob eine Änderung ohne Neuaufbau auskommt, entscheidet das Modul selbst.
   * Ohne onConfigChange gilt: neu aufbauen - das ist der sichere Weg.
   */
  function decide(instance, entry, changed) {
    if (!instance || typeof instance.onConfigChange !== 'function') return 'rebuild';

    try {
      return instance.onConfigChange(entry.config || {}, changed) === 'patch' ? 'patch' : 'rebuild';
    } catch (error) {
      console.error('onConfigChange ist gescheitert:', error);
      return 'rebuild';
    }
  }

  const api = { diff, isEmpty, decide, keyOf, changedKeys };

  if (typeof window !== 'undefined') window.mmReconciler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
