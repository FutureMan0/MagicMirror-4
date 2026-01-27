class UntisModule {
  constructor(config = {}) {
    this.config = {
      server: config.server || '',
      username: config.username || '',
      password: config.password || '',
      school: config.school || '',
      classId: config.classId || 0,
      className: config.className || '',
      viewMode: config.viewMode || 'week',
      colorNormal: config.colorNormal || '#607D8B', // Blaugrau für Standard
      colorSpecial: config.colorSpecial || '#FFA500',
      colorCancelled: config.colorCancelled || '#FF4444'
    };
    
    this.container = null;
    this.timetable = null;
    this.meta = null;
    this.updateInterval = null;
    this.apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  }

  async render() {
    this.container = document.createElement('div');
    this.container.className = 'module-untis';
    
    // Lade Stundenplan über Backend mit Retry
    this.container.innerHTML = '<div class="untis-loading">Lade Stundenplan...</div>';
    
    await this.loadTimetableWithRetry(3);
    
    // Rendere basierend auf View-Mode
    this.renderView();
    
    // Update alle 15 Minuten
    this.updateInterval = setInterval(() => {
      this.loadTimetableWithRetry(2).then(() => this.renderView());
    }, 900000);
    
    return this.container;
  }

  async loadTimetableWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const success = await this.loadTimetable();
      if (success) return true;
      
      if (attempt < maxRetries) {
        console.log(`Untis: Versuch ${attempt} fehlgeschlagen, warte 2s vor erneutem Versuch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    return false;
  }

  async loadTimetable() {
    try {
      const today = new Date();
      
      // Berechne Montag dieser Woche als Startdatum
      const weekStart = new Date(today);
      const dayOfWeek = today.getDay();
      weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const startDate = this.formatDate(weekStart);
      
      // Berechne Freitag dieser Woche als Enddatum
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 4); // Montag + 4 = Freitag
      const endDate = this.formatDate(weekEnd);
      
      // Nutze Backend-API statt direkter WebUntis-Calls
      const response = await fetch(`${this.apiBase}/api/untis/timetable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: this.config.server,
          username: this.config.username,
          password: this.config.password,
          school: this.config.school,
          classId: this.config.classId,
          className: this.config.className,
          startDate: startDate,
          endDate: endDate
        })
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        console.error('Untis API Fehler:', error);
        this.lastError = error.error || `HTTP ${response.status}`;
        this.timetable = null;
        return false;
      }
      
      const data = await response.json();
      this.timetable = data.result || [];
      this.meta = data.meta || {};
      this.lastError = null;
      
      // Reset Meta-Maps damit sie neu erstellt werden
      this._subjectMap = null;
      this._roomMap = null;
      this._teacherMap = null;
      
      // Debug: Zeige Meta-Daten
      console.log(`Untis: ${this.timetable.length} Stunden geladen`);
      console.log(`Untis Meta: ${this.meta.subjects?.length || 0} Fächer, ${this.meta.rooms?.length || 0} Räume, ${this.meta.teachers?.length || 0} Lehrer`);
      if (this.timetable.length > 0) {
        console.log('Untis Beispiel-Stunde:', JSON.stringify(this.timetable[0]));
      }
      return true;
    } catch (error) {
      console.error('Fehler beim Laden des Stundenplans:', error);
      this.lastError = error.message;
      this.timetable = null;
      return false;
    }
  }

  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return parseInt(`${year}${month}${day}`);
  }

  /**
   * Löst Namen aus IDs auf
   */
  resolveName(value, map) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return map?.get(value) || `#${value}`;
    if (typeof value === 'object') {
      const name = value.name || value.longName || value.shortName;
      if (name) return name;
      if (typeof value.id === 'number') return map?.get(value.id) || `#${value.id}`;
    }
    return '';
  }

  /**
   * Erstellt Lookup-Maps für Meta-Daten (einmalig)
   */
  buildMetaMaps() {
    if (!this._subjectMap) {
      // WebUntis verwendet verschiedene Feldnamen: name, longname, shortname (ohne CamelCase!)
      const getName = (item) => item.name || item.longname || item.shortname || item.longName || item.shortName || '';
      
      this._subjectMap = new Map((this.meta?.subjects || []).map(s => [s.id, getName(s)]));
      this._roomMap = new Map((this.meta?.rooms || []).map(r => [r.id, getName(r)]));
      this._teacherMap = new Map((this.meta?.teachers || []).map(t => [t.id, getName(t)]));
      
      // Debug: Zeige erste Einträge
      if (this.meta?.subjects?.length > 0) {
        console.log('Untis Subject Beispiel:', JSON.stringify(this.meta.subjects[0]));
        console.log('Untis SubjectMap Größe:', this._subjectMap.size);
      }
    }
  }

  /**
   * Bereinigt Fachnamen: Entfernt _Zahlen und trailing Zahlen
   * z.B. "SYEN_1" → "SYEN", "DIC1" → "DIC", "E1" → "E"
   */
  cleanSubjectName(name) {
    if (!name) return name;
    // Entferne _Zahl am Ende (z.B. SYEN_1 → SYEN)
    let cleaned = name.replace(/_\d+$/, '');
    // Entferne trailing Zahlen (z.B. DIC1 → DIC, E1 → E)
    // Aber nur wenn davor mindestens 2 Buchstaben sind
    cleaned = cleaned.replace(/^([A-Za-z]{2,})\d+$/, '$1');
    return cleaned;
  }

  /**
   * Extrahiert Fach, Raum und Lehrer aus einer Lektion
   */
  getLessonInfo(lesson) {
    this.buildMetaMaps();
    
    // WebUntis verwendet su/ro/te - diese enthalten Objekte mit {id, name, longname}
    const subjectObj = lesson.su?.[0] || lesson.subjects?.[0];
    const roomObj = lesson.ro?.[0] || lesson.rooms?.[0];
    const teacherObj = lesson.te?.[0] || lesson.teachers?.[0];
    
    // Versuche zuerst den Namen direkt aus dem Objekt zu lesen
    const getNameFromObj = (obj) => {
      if (!obj) return null;
      if (typeof obj === 'string') return obj;
      return obj.name || obj.longname || obj.shortname || null;
    };
    
    // Extrahiere IDs für Fallback
    const subjectId = typeof subjectObj === 'object' ? subjectObj?.id : subjectObj;
    const roomId = typeof roomObj === 'object' ? roomObj?.id : roomObj;
    const teacherId = typeof teacherObj === 'object' ? teacherObj?.id : teacherObj;
    
    // Name aus Objekt oder aus Map oder als ID
    let subject = getNameFromObj(subjectObj) || this._subjectMap.get(subjectId) || (subjectId ? `#${subjectId}` : '?');
    const room = getNameFromObj(roomObj) || this._roomMap.get(roomId) || (roomId ? `#${roomId}` : '');
    const teacher = getNameFromObj(teacherObj) || this._teacherMap.get(teacherId) || (teacherId ? `#${teacherId}` : '');
    
    // Bereinige Fachnamen (entferne _1, _2, trailing Zahlen)
    subject = this.cleanSubjectName(subject);
    
    return { subject, room, teacher };
  }

  /**
   * Konvertiert Datum aus Integer (20260127) zu Date-Objekt
   */
  parseDate(dateInt) {
    const str = dateInt.toString();
    const year = parseInt(str.slice(0, 4), 10);
    const month = parseInt(str.slice(4, 6), 10) - 1; // JavaScript months are 0-indexed
    const day = parseInt(str.slice(6, 8), 10);
    return new Date(year, month, day, 0, 0, 0);
  }

  renderView() {
    if (!this.timetable || this.timetable.length === 0) {
      const errorMsg = this.lastError 
        ? `<div class="untis-error">Fehler: ${this.lastError}</div><div class="untis-retry">Nächster Versuch in 15 min</div>`
        : '<div class="untis-empty">Keine Stunden gefunden</div>';
      this.container.innerHTML = errorMsg;
      return;
    }
    
    switch (this.config.viewMode) {
      case 'week':
        this.renderWeekView();
        break;
      case 'day':
        this.renderDayView();
        break;
      case 'next':
        this.renderNextView();
        break;
    }
  }

  renderWeekView() {
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    
    const weekStart = new Date(today);
    const dayOfWeek = today.getDay();
    // Montag dieser Woche
    weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    weekStart.setHours(0, 0, 0, 0);
    
    // Gruppiere Stunden nach Tag
    const byDay = {};
    this.timetable.forEach(lesson => {
      // Datum kann als Integer (20260127) oder String kommen
      const date = typeof lesson.date === 'number' ? this.parseDate(lesson.date) : new Date(lesson.date);
      const dayKey = date.toDateString();
      if (!byDay[dayKey]) {
        byDay[dayKey] = [];
      }
      byDay[dayKey].push(lesson);
    });
    
    // Sortiere Stunden pro Tag nach Startzeit
    Object.keys(byDay).forEach(dayKey => {
      byDay[dayKey].sort((a, b) => a.startTime - b.startTime);
    });
    
    // Extrahiere alle einzigartigen Startzeiten für das Zeitraster (DYNAMISCH)
    const allStartTimes = new Set();
    this.timetable.forEach(lesson => {
      if (lesson.startTime) {
        allStartTimes.add(lesson.startTime);
      }
    });
    
    // Erstelle dynamische Zeitslots aus den tatsächlichen Startzeiten
    const timeSlots = Array.from(allStartTimes)
      .sort((a, b) => a - b)
      .map((time, index) => ({
        time: this.formatTime(time),
        rawTime: time,
        period: index + 1
      }));
    
    let html = '<div class="untis-week-view">';
    html += '<div class="untis-header">';
    
    // Leere Zelle für Zeit-Spalte
    html += '<div class="untis-header-time"></div>';
    
    // Header mit Tagen
    for (let i = 0; i < 5; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      date.setHours(0, 0, 0, 0);
      const dayName = days[i];
      const dayNum = date.getDate();
      const isToday = date.getTime() === todayTime;
      const isPastDay = date.getTime() < todayTime; // Numerischer Vergleich!
      
      let headerClass = 'untis-day-header';
      if (isToday) headerClass += ' untis-today';
      if (isPastDay) headerClass += ' untis-past-day';
      
      html += `<div class="${headerClass}">${dayNum} ${dayName}.</div>`;
    }
    
    html += '</div>';
    
    // Stunden-Grid
    html += '<div class="untis-grid">';
    
    // Aktuelle Zeit für Vergangenheits-Check
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    
    // Für jedes Zeitslot (DYNAMISCH aus echten Daten)
    timeSlots.forEach((slot, slotIndex) => {
      // Slot-Zeit in Minuten
      const slotHours = Math.floor(slot.rawTime / 100);
      const slotMins = slot.rawTime % 100;
      const slotMinutes = slotHours * 60 + slotMins;
      
      // Prüfe ob dies der aktuelle Zeitslot ist (heute zwischen Start und nächstem Slot)
      const nextSlot = timeSlots[slotIndex + 1];
      const nextSlotMinutes = nextSlot ? (Math.floor(nextSlot.rawTime / 100) * 60 + (nextSlot.rawTime % 100)) : (slotMinutes + 60);
      const isCurrentSlot = nowMinutes >= slotMinutes && nowMinutes < nextSlotMinutes;
      
      html += `<div class="untis-time-slot${isCurrentSlot ? ' untis-current-slot' : ''}">
        <div class="untis-time">${slot.time}</div>
        <div class="untis-period">${slot.period}.</div>
      </div>`;
      
      // Stunden für jeden Tag
      for (let day = 0; day < 5; day++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + day);
        date.setHours(0, 0, 0, 0);
        const dayKey = date.toDateString();
        const dayLessons = byDay[dayKey] || [];
        
        // Finde ALLE Stunden mit dieser Startzeit (filter statt find)
        const lessons = dayLessons.filter(l => l.startTime === slot.rawTime);
        
        // Vergangene Tage ausgrauen
        const isPastDay = date.getTime() < todayTime;
        let isPastSlot = false;
        
        // Am heutigen Tag: Nur Stunden ausgrauen die komplett vorbei sind
        if (date.getTime() === todayTime) {
          // Verwende die Startzeit des NÄCHSTEN Slots als Grenze
          // Eine Stunde ist "vorbei" wenn der nächste Slot bereits begonnen hat
          const nextSlot = timeSlots[slotIndex + 1];
          if (nextSlot) {
            const nextSlotHours = Math.floor(nextSlot.rawTime / 100);
            const nextSlotMins = nextSlot.rawTime % 100;
            const nextSlotMinutes = nextSlotHours * 60 + nextSlotMins;
            isPastSlot = nowMinutes >= nextSlotMinutes;
          }
        }
        
        const isPast = isPastDay || isPastSlot;
        
        if (lessons.length > 0) {
          // Zeige alle Stunden in dieser Zelle
          html += `<div class="untis-cell${isPast ? ' untis-past' : ''}">`;
          lessons.forEach(lesson => {
            const color = this.getLessonColor(lesson);
            const info = this.getLessonInfo(lesson);
            html += `<div class="untis-lesson" style="background-color: ${color}">
              <div class="untis-subject">${info.subject}</div>
              <div class="untis-room">${info.room}</div>
              <div class="untis-teacher">${info.teacher}</div>
            </div>`;
          });
          html += '</div>';
        } else {
          html += `<div class="untis-empty-slot${isPast ? ' untis-past' : ''}"></div>`;
        }
      }
    });
    
    // Zeitlinie über das gesamte Grid hinzufügen
    let currentSlotIndex = -1;
    for (let i = 0; i < timeSlots.length; i++) {
      const slot = timeSlots[i];
      const nextSlot = timeSlots[i + 1];
      const slotHours = Math.floor(slot.rawTime / 100);
      const slotMins = slot.rawTime % 100;
      const slotMinutes = slotHours * 60 + slotMins;
      const nextSlotMinutes = nextSlot ? (Math.floor(nextSlot.rawTime / 100) * 60 + (nextSlot.rawTime % 100)) : (slotMinutes + 60);
      
      if (nowMinutes >= slotMinutes && nowMinutes < nextSlotMinutes) {
        currentSlotIndex = i;
        break;
      }
    }
    
    if (currentSlotIndex >= 0) {
      // Berechne Position: (Zeile * (min-height + gap))
      const rowHeight = 62; // 55px min-height + ~7px für gap und padding
      const topPosition = (currentSlotIndex * rowHeight) + 30; // +30 für halbe Zeilenhöhe
      html += `<div class="untis-time-line" style="top: ${topPosition}px;"></div>`;
    }
    
    html += '</div></div>';
    
    this.container.innerHTML = html;
  }

  renderDayView() {
    const today = new Date();
    const todayKey = today.toDateString();
    const lessons = this.timetable.filter(l => {
      const date = typeof l.date === 'number' ? this.parseDate(l.date) : new Date(l.date);
      return date.toDateString() === todayKey;
    }).sort((a, b) => a.startTime - b.startTime);
    
    let html = '<div class="untis-day-view">';
    html += `<h3 class="untis-day-title">Heute, ${today.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</h3>`;
    
    lessons.forEach(lesson => {
      const color = this.getLessonColor(lesson);
      const info = this.getLessonInfo(lesson);
      html += `<div class="untis-lesson-card" style="border-left: 4px solid ${color}">
        <div class="untis-lesson-time">${this.formatTime(lesson.startTime)} - ${this.formatTime(lesson.endTime)}</div>
        <div class="untis-lesson-subject">${info.subject}</div>
        <div class="untis-lesson-details">${info.room} | ${info.teacher}</div>
      </div>`;
    });
    
    html += '</div>';
    this.container.innerHTML = html;
  }

  renderNextView() {
    const now = new Date();
    const nextLesson = this.timetable
      .filter(l => {
        const date = typeof l.date === 'number' ? this.parseDate(l.date) : new Date(l.date);
        return date >= now;
      })
      .sort((a, b) => {
        const dateA = typeof a.date === 'number' ? this.parseDate(a.date) : new Date(a.date);
        const dateB = typeof b.date === 'number' ? this.parseDate(b.date) : new Date(b.date);
        return dateA - dateB;
      })[0];
    
    if (!nextLesson) {
      this.container.innerHTML = '<div class="untis-empty">Keine weiteren Stunden</div>';
      return;
    }
    
    const color = this.getLessonColor(nextLesson);
    const info = this.getLessonInfo(nextLesson);
    const date = typeof nextLesson.date === 'number' ? this.parseDate(nextLesson.date) : new Date(nextLesson.date);
    
    this.container.innerHTML = `
      <div class="untis-next-view">
        <div class="untis-next-label">Nächste Stunde</div>
        <div class="untis-next-time">${date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <div class="untis-next-subject" style="color: ${color}">${info.subject}</div>
        <div class="untis-next-details">${this.formatTime(nextLesson.startTime)} - ${this.formatTime(nextLesson.endTime)}</div>
        <div class="untis-next-room">${info.room} | ${info.teacher}</div>
      </div>
    `;
  }

  getTimeSlots() {
    // Zeitraster
    return [
      { time: '08:00', period: 1 },
      { time: '08:50', period: 2 },
      { time: '10:00', period: 3 },
      { time: '10:55', period: 4 },
      { time: '12:00', period: 5 },
      { time: '12:50', period: 6 },
      { time: '14:00', period: 7 },
      { time: '14:50', period: 8 }
    ];
  }

  isInTimeSlot(lesson, slot) {
    if (!lesson.startTime) return false;
    
    // Konvertiere Slot-Zeit zu Minuten seit Mitternacht
    const [slotHours, slotMinutes] = slot.time.split(':').map(Number);
    const slotTotalMinutes = slotHours * 60 + slotMinutes;
    
    // Konvertiere Lesson-Startzeit zu Minuten seit Mitternacht
    const lessonHours = Math.floor(lesson.startTime / 100);
    const lessonMinutes = lesson.startTime % 100;
    const lessonTotalMinutes = lessonHours * 60 + lessonMinutes;
    
    // Prüfe ob die Stunde in diesem Slot beginnt (mit 10 Minuten Toleranz für Verspätungen/Verschiebungen)
    return Math.abs(lessonTotalMinutes - slotTotalMinutes) <= 10;
  }

  formatTime(time) {
    const hours = Math.floor(time / 100);
    const minutes = time % 100;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  getLessonColor(lesson) {
    // Entfallene Stunden - Rot mit Transparenz
    if (lesson.code === 'cancelled' || lesson.cellState === 'CANCEL') {
      return '#EF5350'; // Material Red 400
    }
    
    // Vertretung/Änderung - Warmes Orange
    if (lesson.code === 'irregular' || lesson.cellState === 'SUBSTITUTION' || lesson.lstext) {
      return '#FF9800'; // Material Orange
    }
    
    // Farbwahl basierend auf Fach-Kategorie
    const info = this.getLessonInfo(lesson);
    const subject = info.subject.toLowerCase();
    
    // Mathematik/Analysis - Lebendiges Cyan
    if (['am', 'mat', 'mathe', 'mathematik', 'analysis'].some(s => subject.includes(s))) {
      return '#00BCD4'; // Cyan 500
    }
    
    // Informatik/Programmieren - Tiefes Blau
    if (['inf', 'informatik', 'dic', 'prog', 'syen', 'it'].some(s => subject.includes(s))) {
      return '#2196F3'; // Blue 500
    }
    
    // Elektrotechnik/Hardware - Electric Blue
    if (['fsst', 'hwe', 'hwt', 'nwt', 'ele', 'etec'].some(s => subject.includes(s))) {
      return '#03A9F4'; // Light Blue 500
    }
    
    // Physik/Naturwissenschaft - Deep Purple
    if (['phy', 'physik', 'eth', 'chemie', 'che'].some(s => subject.includes(s))) {
      return '#673AB7'; // Deep Purple 500
    }
    
    // Sprachen (Deutsch) - Lebendiges Grün
    if (['d', 'deu', 'deutsch'].some(s => subject === s || subject.startsWith(s))) {
      return '#4CAF50'; // Green 500
    }
    
    // Sprachen (Englisch) - Teal
    if (['e', 'eng', 'englisch'].some(s => subject === s || subject.startsWith(s))) {
      return '#009688'; // Teal 500
    }
    
    // Wirtschaft/Recht - Elegantes Violett
    if (['wir', 'wirtschaft', 'bwl', 'vwl', 'recht', 'rw'].some(s => subject.includes(s))) {
      return '#9C27B0'; // Purple 500
    }
    
    // Sport - Energetisches Pink
    if (['spo', 'sport', 'bsp', 'turn'].some(s => subject.includes(s))) {
      return '#E91E63'; // Pink 500
    }
    
    // Religion/Ethik - Purple
    if (['rel', 'religion', 'rk', 'ev', 're'].some(s => subject === s)) {
      return '#9C27B0'; // Purple für Religion
    }
    
    // Kunst/Musik/Kreativ - Coral
    if (['kunst', 'ku', 'musik', 'mu', 'kreativ'].some(s => subject.includes(s))) {
      return '#FF7043'; // Deep Orange 400
    }
    
    // Labor/Praktikum - Mint
    if (['lab', 'labor', 'prak', 'praktikum', 'la1', 'mtrs'].some(s => subject.includes(s))) {
      return '#26A69A'; // Teal 400
    }
    
    // KSN/Kommunikation - Indigo
    if (['ksn', 'komm', 'ksnw'].some(s => subject.includes(s))) {
      return '#5C6BC0'; // Indigo 400
    }
    
    // w-di (Wahlpflicht) - Lime
    if (['w-', 'wahl', 'wpf'].some(s => subject.includes(s))) {
      return '#00ACC1'; // Cyan 600
    }
    
    // Standard-Farbe - Elegantes Slate Blue
    return '#546E7A'; // Blue Grey 600
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.untis = UntisModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UntisModule;
}
