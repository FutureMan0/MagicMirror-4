(function () {
  /**
   * Zonen statt freiem Raster.
   *
   * Warum: Ein 8×10-Raster auf einem 390 Pixel breiten Telefon ergibt Zellen
   * von 35 Pixeln. Darauf zielt niemand mit dem Daumen. Und selbst wer trifft,
   * baut sich damit meistens ein unaufgeräumtes Layout — die Freiheit war
   * größer als der Nutzen.
   *
   * Sechs Zonen decken ab, was ein Spiegel an der Wand braucht. Jede hat eine
   * feste Fläche im Grundraster, eine Leserichtung und eine Vorstellung davon,
   * wie viel Inhalt hineinpasst. Wer mehr Freiheit will, kann weiterhin
   * Spalte/Zeile von Hand setzen — das bleibt unangetastet.
   *
   * Das Grundraster ist bewusst grob:
   *
   *     ┌───────────┬───────────┬───────────┐
   *     │ oben-links│  oben-    │oben-rechts│
   *     │           │  mitte    │           │
   *     ├───────────┼───────────┼───────────┤
   *     │   links   │   mitte   │   rechts  │
   *     │  (hoch)   │  (groß)   │  (hoch)   │
   *     ├───────────┴───────────┴───────────┤
   *     │              unten                │
   *     └───────────────────────────────────┘
   */

  const ZONEN = [
    {
      id: 'oben-links',
      label: { de: 'Oben links', en: 'Top left' },
      gridColumn: '1', gridRow: '1',
      justify: 'start', align: 'start'
    },
    {
      id: 'oben-mitte',
      label: { de: 'Oben mitte', en: 'Top centre' },
      gridColumn: '2', gridRow: '1',
      justify: 'center', align: 'start'
    },
    {
      id: 'oben-rechts',
      label: { de: 'Oben rechts', en: 'Top right' },
      gridColumn: '3', gridRow: '1',
      justify: 'end', align: 'start'
    },
    {
      id: 'links',
      label: { de: 'Linke Spalte', en: 'Left column' },
      gridColumn: '1', gridRow: '2',
      justify: 'stretch', align: 'stretch'
    },
    {
      id: 'mitte',
      label: { de: 'Mitte', en: 'Centre' },
      gridColumn: '2', gridRow: '2',
      justify: 'stretch', align: 'stretch'
    },
    {
      id: 'rechts',
      label: { de: 'Rechte Spalte', en: 'Right column' },
      gridColumn: '3', gridRow: '2',
      justify: 'stretch', align: 'stretch'
    },
    {
      id: 'unten',
      label: { de: 'Unten', en: 'Bottom' },
      gridColumn: '1 / -1', gridRow: '3',
      justify: 'stretch', align: 'end'
    }
  ];

  /** Das Raster, in dem die Zonen liegen. Grob und fest. */
  const ZONEN_RASTER = {
    columns: 3,
    rows: 3,
    columnSizes: ['1fr', '1fr', '1fr'],
    // Kopf und Fuß nehmen nur, was sie brauchen; die Mitte bekommt den Rest.
    rowSizes: ['auto', '1fr', 'auto'],
    gap: 24,
    padding: 32
  };

  const NACH_ID = new Map(ZONEN.map(z => [z.id, z]));

  /** Ist das eine Zonen-Angabe? */
  function istZone(position) {
    return typeof position === 'string' && NACH_ID.has(position);
  }

  /** Die Zone zu einer Kennung, oder null. */
  function zone(id) {
    return NACH_ID.get(id) || null;
  }

  /**
   * Alte Positionsnamen auf Zonen abbilden. `top_left` und Verwandte gab es
   * vor den Zonen; sie sollen weiter funktionieren.
   */
  const ALTE_NAMEN = {
    top_left: 'oben-links',
    top_center: 'oben-mitte',
    top_right: 'oben-rechts',
    middle_left: 'links',
    middle_center: 'mitte',
    middle_right: 'rechts',
    bottom_left: 'unten',
    bottom_center: 'unten',
    bottom_right: 'unten'
  };

  /**
   * Bringt eine beliebige gespeicherte Position auf eine Zone — oder gibt
   * null zurück, wenn es eine Rasterangabe ist und bleiben soll.
   */
  function alsZone(position) {
    if (istZone(position)) return position;
    if (typeof position === 'string' && ALTE_NAMEN[position]) return ALTE_NAMEN[position];
    return null;
  }

  /** Beschriftung in der gewünschten Sprache. */
  function zonenLabel(id, sprache = 'de') {
    const z = zone(id);
    if (!z) return id;
    return z.label[sprache === 'en' ? 'en' : 'de'];
  }

  /**
   * Die fertige Platzierung zu einer gespeicherten Position - oder null,
   * wenn es keine Zone ist.
   *
   * Bewusst hier und nicht im Renderer: dort sass sie einmal in der falschen
   * Funktion und wurde nie erreicht. Die Module standen dann automatisch
   * nebeneinander, und von aussen sah es aus, als kaeme die Zone nicht an.
   * Hier laesst sie sich ohne Browser pruefen.
   */
  function platzierung(position) {
    const id = alsZone(position);
    if (!id) return null;

    const z = zone(id);
    return {
      type: 'grid',
      gridColumn: z.gridColumn,
      gridRow: z.gridRow,
      justifySelf: 'stretch',
      alignSelf: 'stretch',
      contentJustify: z.justify,
      contentAlign: z.align,
      zone: id
    };
  }

  const api = { ZONEN, ZONEN_RASTER, istZone, zone, alsZone, zonenLabel, platzierung, ALTE_NAMEN };

  if (typeof window !== 'undefined') window.MMZonen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
