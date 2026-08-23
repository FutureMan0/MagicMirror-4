// Ein gemeinsamer Sekundentakt.
//
// Jedes Modul, das die Zeit anzeigt oder regelmäßig etwas prüft, hatte bisher
// sein eigenes setInterval. Bei fünf Modulen sind das fünf Timer, die
// unabhängig voneinander aufwachen und den Renderer je einzeln beschäftigen.
//
// Hier läuft genau eine Schleife und meldet:
//
//   tick:second   jede Sekunde
//   tick:minute   beim Minutenwechsel
//
// Der Takt richtet sich an der Systemuhr aus, statt stur 1000 ms zu warten:
// ein setInterval driftet, und ein Sekundenzeiger, der bei 999 ms springt,
// sieht falsch aus.
(function () {
  if (!window.mmBus) {
    console.error('clockTick: Bus nicht gefunden.');
    return;
  }

  let timeoutId = null;
  let lastMinute = -1;

  function schedule() {
    const now = new Date();
    // Bis zum nächsten vollen Sekundenwechsel warten.
    const delay = 1000 - now.getMilliseconds();

    timeoutId = setTimeout(() => {
      const tickTime = new Date();

      window.mmBus.emit('tick:second', { date: tickTime });

      if (tickTime.getMinutes() !== lastMinute) {
        lastMinute = tickTime.getMinutes();
        window.mmBus.emit('tick:minute', { date: tickTime });
      }

      schedule();
    }, delay);
  }

  // Bei verstecktem Fenster drosselt Chromium Timer ohnehin; nach dem
  // Sichtbarwerden sofort nachziehen, damit die Anzeige nicht springt.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      window.mmBus.emit('tick:second', { date: new Date() });
    }
  });

  schedule();

  window.mmClockTick = {
    stop: () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
})();
