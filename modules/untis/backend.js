// Untis Backend API Module
// Stellt API-Routen für WebUntis bereit

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

// Cache für Untis-Daten
const untisCache = new Map();

/**
 * Hilfsfunktion zum Formatieren von Daten
 */
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return parseInt(`${year}${month}${day}`, 10);
};

/**
 * Hilfsfunktion zum Verzögern von Requests
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Timetable API Handler
 */
async function handleTimetable(req, res, { instanceName, ConfigManager }) {
  try {
    const instance = req.query.instance || instanceName;
    const instanceConfigManager = new ConfigManager(instance);
    const config = instanceConfigManager.loadConfig();

    const untisModule = config.modules?.find(m => m.module === 'untis') || {};
    const moduleConfig = untisModule.config || {};
    const envConfig = config.env || {};

    const server = req.body.server || moduleConfig.server || envConfig.untisServer;
    const username = req.body.username || moduleConfig.username || envConfig.untisUsername;
    const password = req.body.password || moduleConfig.password || envConfig.untisPassword;
    const school = req.body.school || moduleConfig.school || envConfig.untisSchool;
    const classIdRaw = req.body.classId || moduleConfig.classId || 0;
    let className = req.body.className || moduleConfig.className || '';
    let classId = parseInt(classIdRaw, 10);
    
    if (!Number.isFinite(classId)) {
      classId = 0;
    }
    if (!classId && typeof classIdRaw === 'string' && classIdRaw.trim()) {
      className = className || classIdRaw.trim();
    }

    if (!server || !username || !password) {
      return res.status(400).json({ error: 'WebUntis ist nicht vollständig konfiguriert.' });
    }

    console.log(`WebUntis Login Versuch: Server=${server}, User=${username}, School=${school || '(none)'}`);

    const authController = new AbortController();
    const authTimeout = setTimeout(() => authController.abort(), 12000);
    const authBody = {
      id: '1234',
      method: 'authenticate',
      params: {
        user: username,
        password: password,
        client: 'MagicMirror'
        // HINWEIS: School-Parameter wird absichtlich NICHT mitgesendet,
        // da er bei manchen Accounts zu Fehlern führt (Error -8998)
      },
      jsonrpc: '2.0'
    };

    const authResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: authController.signal,
      body: JSON.stringify(authBody)
    });
    clearTimeout(authTimeout);

    const authData = await authResponse.json();
    console.log('WebUntis Auth Response:', JSON.stringify(authData, null, 2));

    if (!authResponse.ok) {
      console.error(`WebUntis Auth HTTP Fehler: ${authResponse.status}`);
      return res.status(500).json({ error: `WebUntis Login fehlgeschlagen (HTTP ${authResponse.status})` });
    }

    if (authData?.error) {
      console.error('WebUntis Auth Fehler:', authData.error);
      return res.status(401).json({ 
        error: `WebUntis Login fehlgeschlagen: ${authData.error.message || authData.error.code || 'Unbekannter Fehler'}` 
      });
    }

    const sessionId = authData?.result?.sessionId;
    if (!sessionId) {
      console.error('Keine Session-ID in Response:', authData);
      return res.status(401).json({ error: 'WebUntis Login fehlgeschlagen: Keine Session-ID erhalten.' });
    }

    console.log('WebUntis Login erfolgreich, Session-ID:', sessionId);

    const today = new Date();
    const startDate = req.body.startDate || formatDate(today);
    const endDate = req.body.endDate || formatDate(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));
    const cacheKey = `${instance}|${server}|${school}|${classId || className}|${startDate}|${endDate}`;
    const cached = untisCache.get(cacheKey);
    const cacheTtlMs = 4 * 60 * 60 * 1000;
    
    // Cache nur verwenden wenn er Fächer enthält (vollständige Meta-Daten)
    if (cached && Date.now() - cached.timestamp < cacheTtlMs && cached.data?.meta?.subjects?.length > 0) {
      console.log('WebUntis: Verwende gecachte Daten');
      return res.json(cached.data);
    }

    if (!classId && className) {
      const classesResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do;jsessionid=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '5',
          method: 'getKlassen',
          params: {},
          jsonrpc: '2.0'
        })
      });

      const classesData = await classesResponse.json();
      const classes = classesData?.result || [];
      const target = classes.find((c) => {
        const name = (c.name || '').toLowerCase();
        const longName = (c.longName || '').toLowerCase();
        const targetName = className.toLowerCase();
        return name === targetName || longName === targetName;
      });
      
      if (!target) {
        return res.status(404).json({ error: `Klasse "${className}" nicht gefunden.` });
      }
      classId = target.id;
    }

    if (!classId) {
      return res.status(400).json({ error: 'classId fehlt. Bitte Klassen-ID oder Klassenname setzen.' });
    }

    const fetchUntisRpc = async (method, params = {}) => {
      const response = await fetch(`https://${server}/WebUntis/jsonrpc.do;jsessionid=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '5',
          method,
          params,
          jsonrpc: '2.0'
        })
      });
      const data = await response.json();
      if (data?.error) {
        throw new Error(data.error?.message || 'WebUntis Fehler');
      }
      return data?.result || [];
    };

    // Meta-Daten laden mit Retry-Logik für Rate-Limiting
    let subjects = [];
    let rooms = [];
    let teachers = [];
    
    // Hilfsfunktion: Lade mit Retry
    const fetchWithRetry = async (method, maxRetries = 3) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await delay(attempt * 300); // Längere Pause bei jedem Versuch
          const result = await fetchUntisRpc(method);
          console.log(`WebUntis: ${method}() erfolgreich - ${result.length} Einträge`);
          return result;
        } catch (error) {
          if (error.message.includes('no right')) {
            console.warn(`WebUntis: ${method}() - keine Berechtigung`);
            return []; // Keine Berechtigung, kein Retry nötig
          }
          console.warn(`WebUntis: ${method}() Versuch ${attempt}/${maxRetries} fehlgeschlagen: ${error.message}`);
          if (attempt === maxRetries) return [];
        }
      }
      return [];
    };
    
    // Lade alle Meta-Daten mit Retry
    subjects = await fetchWithRetry('getSubjects');
    rooms = await fetchWithRetry('getRooms');
    teachers = await fetchWithRetry('getTeachers');

    const timetableController = new AbortController();
    const timetableTimeout = setTimeout(() => timetableController.abort(), 12000);
    const timetableResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do;jsessionid=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timetableController.signal,
      body: JSON.stringify({
        id: '5',
        method: 'getTimetable',
        params: {
          id: classId,
          type: 1,
          startDate: startDate,
          endDate: endDate
        },
        jsonrpc: '2.0'
      })
    });
    clearTimeout(timetableTimeout);

    if (!timetableResponse.ok) {
      return res.status(500).json({ error: `WebUntis Fehler (${timetableResponse.status})` });
    }

    const timetableData = await timetableResponse.json();
    if (timetableData?.error) {
      console.error('WebUntis getTimetable Fehler:', timetableData.error);
      return res.status(500).json({ error: timetableData.error?.message || 'WebUntis Fehler' });
    }

    const responseData = {
      school,
      server,
      result: timetableData?.result || [],
      meta: {
        subjects,
        rooms,
        teachers
      }
    };
    
    // Cache nur speichern wenn Meta-Daten vollständig (min. Fächer vorhanden)
    if (subjects.length > 0) {
      untisCache.set(cacheKey, { timestamp: Date.now(), data: responseData });
      console.log(`WebUntis Daten geladen und gecacht: ${responseData.result.length} Stunden, ${subjects.length} Fächer, ${rooms.length} Räume, ${teachers.length} Lehrer`);
    } else {
      console.log(`WebUntis Daten geladen (NICHT gecacht - Fächer fehlen): ${responseData.result.length} Stunden, ${subjects.length} Fächer, ${rooms.length} Räume, ${teachers.length} Lehrer`);
    }
    res.json(responseData);
  } catch (error) {
    console.error('WebUntis API Fehler:', error);
    const message = error.name === 'AbortError' ? 'WebUntis Timeout' : error.message;
    res.status(500).json({ error: message });
  }
}

/**
 * Test-Auth API Handler
 */
async function handleTestAuth(req, res, { instanceName, ConfigManager }) {
  try {
    const instance = req.query.instance || instanceName;
    const instanceConfigManager = new ConfigManager(instance);
    const config = instanceConfigManager.loadConfig();

    const untisModule = config.modules?.find(m => m.module === 'untis') || {};
    const moduleConfig = untisModule.config || {};
    const envConfig = config.env || {};

    const server = moduleConfig.server || envConfig.untisServer;
    const username = moduleConfig.username || envConfig.untisUsername;
    const password = moduleConfig.password || envConfig.untisPassword;
    const school = moduleConfig.school || envConfig.untisSchool;

    console.log('=== WebUntis Auth Test ===');
    console.log('Server:', server);
    console.log('Username:', username ? '***' + username.slice(-4) : 'fehlt');
    console.log('Password:', password ? '***' : 'fehlt');
    console.log('School:', school || '(nicht gesetzt)');

    if (!server || !username || !password) {
      return res.status(400).json({ 
        error: 'WebUntis ist nicht vollständig konfiguriert.',
        details: {
          server: !!server,
          username: !!username,
          password: !!password
        }
      });
    }

    const authBody = {
      id: 'test-auth',
      method: 'authenticate',
      params: {
        user: username,
        password: password,
        client: 'MagicMirror'
        // School-Parameter wird absichtlich weggelassen
      },
      jsonrpc: '2.0'
    };

    const authResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody)
    });

    const authData = await authResponse.json();
    console.log('Response Status:', authResponse.status);
    console.log('Response Body:', JSON.stringify(authData, null, 2));

    if (authData?.error) {
      return res.status(401).json({
        success: false,
        error: authData.error.message || authData.error.code,
        details: authData.error
      });
    }

    if (authData?.result?.sessionId) {
      return res.json({
        success: true,
        message: 'Authentifizierung erfolgreich',
        sessionId: authData.result.sessionId.substring(0, 8) + '...'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Unerwartete Response',
      data: authData
    });
  } catch (error) {
    console.error('Auth Test Fehler:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}

/**
 * Classes API Handler
 */
async function handleClasses(req, res, { instanceName, ConfigManager }) {
  try {
    const instance = req.query.instance || instanceName;
    const instanceConfigManager = new ConfigManager(instance);
    const config = instanceConfigManager.loadConfig();

    const untisModule = config.modules?.find(m => m.module === 'untis') || {};
    const moduleConfig = untisModule.config || {};
    const envConfig = config.env || {};

    const server = moduleConfig.server || envConfig.untisServer;
    const username = moduleConfig.username || envConfig.untisUsername;
    const password = moduleConfig.password || envConfig.untisPassword;
    const school = moduleConfig.school || envConfig.untisSchool;

    if (!server || !username || !password) {
      return res.status(400).json({ error: 'WebUntis ist nicht vollständig konfiguriert.' });
    }

    const authBody = {
      id: '1234',
      method: 'authenticate',
      params: {
        user: username,
        password: password,
        client: 'MagicMirror'
        // School-Parameter wird absichtlich weggelassen
      },
      jsonrpc: '2.0'
    };

    const authResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody)
    });

    const authData = await authResponse.json();
    
    if (authData?.error) {
      return res.status(401).json({ error: authData.error.message || 'WebUntis Login fehlgeschlagen' });
    }
    
    const sessionId = authData?.result?.sessionId;
    if (!sessionId) {
      return res.status(401).json({ error: 'WebUntis Login fehlgeschlagen.' });
    }

    const classesResponse = await fetch(`https://${server}/WebUntis/jsonrpc.do;jsessionid=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '5',
        method: 'getKlassen',
        params: {},
        jsonrpc: '2.0'
      })
    });

    const classesData = await classesResponse.json();
    if (classesData?.error) {
      return res.status(500).json({ error: classesData.error?.message || 'WebUntis Fehler' });
    }

    res.json({
      result: classesData?.result || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Exportiert die API-Routen für das Untis-Modul
 */
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/api/untis/timetable',
      handler: handleTimetable
    },
    {
      method: 'POST',
      path: '/api/untis/test-auth',
      handler: handleTestAuth
    },
    {
      method: 'GET',
      path: '/api/untis/classes',
      handler: handleClasses
    }
  ]
};
