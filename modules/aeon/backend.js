const { defineHttpModule } = require('../../src/main/integrations/httpModule');

/**
 * AEON, the house's assistant.
 *
 * Two of Cortex's endpoints, both on the home network:
 *
 *   GET /v1/feed      what AEON said and did unasked
 *   GET /v1/calendar  what is coming, as the viewer may see it
 *
 * Only what AEON said aloud in the house is shown: a message that went to
 * a phone, or was held back in front of guests, was not meant for the
 * hallway. Without a token the calendar shows what the whole household may
 * see; a paired device's token (POST /v1/pairing) shows that person's own
 * appointments too. The token is read here and never reaches the browser.
 */

function base(config) {
  const url = String(config.cortexUrl || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(url) ? url : null;
}

function headers(config) {
  return {
    Accept: 'application/json',
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
  };
}

/** "09:30", or null for an all-day entry. */
function clock(iso, allDay) {
  if (allDay) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

function dayOf(iso, now) {
  const at = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((at - start) / 86400000);
  return days <= 0 ? 'heute' : days === 1 ? 'morgen' : at.toLocaleDateString('de-AT', { weekday: 'long' });
}

module.exports = defineHttpModule({
  name: 'aeon',

  defaults: {
    cortexUrl: 'http://127.0.0.1:8010',
    token: '',
    showOrb: true,
    maxSaid: 3,
    maxEntries: 4,
    days: 1,
    updateInterval: 60000,
    minInterval: 15000
  },

  buildRequests(config) {
    const url = base(config);
    if (!url) return [];
    const days = Math.min(7, Math.max(1, Number(config.days) || 1));
    return [
      { url: `${url}/v1/feed`, headers: headers(config), conditional: false },
      { url: `${url}/v1/calendar?days=${days}`, headers: headers(config), conditional: false }
    ];
  },

  transform(responses, config, now = new Date()) {
    const [feed, calendar] = responses;
    const said = (feed && Array.isArray(feed.feed) ? feed.feed : [])
      .filter(item => item && item.outcome === 'said' && item.text)
      .slice(-Math.max(0, Number(config.maxSaid) || 0))
      .reverse()
      .map(item => ({ at: String(item.at || ''), text: String(item.text) }));
    const entries = (calendar && Array.isArray(calendar.entries) ? calendar.entries : [])
      .slice(0, Math.max(0, Number(config.maxEntries) || 0))
      .map(entry => ({
        day: dayOf(entry.start, now),
        at: clock(entry.start, entry.all_day),
        title: String(entry.title || '')
      }));
    return {
      said,
      entries,
      calendar: Boolean(calendar && calendar.enabled),
      governor: Boolean(feed && feed.enabled)
    };
  },

  async testConnection(config, request) {
    const url = base(config);
    if (!url) return { ok: false, error: 'Es fehlt noch die Adresse von Cortex (http://…:8010).' };
    try {
      await request({ url: `${url}/v1/feed`, headers: headers(config) });
      return { ok: true, message: 'AEON antwortet.' };
    } catch (error) {
      return {
        ok: false,
        error: error.code === 401 ? 'Das Token ist nicht (mehr) gekoppelt.' : error.message
      };
    }
  }
});
