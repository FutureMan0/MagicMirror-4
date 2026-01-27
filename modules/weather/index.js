class WeatherModule {
  constructor(config = {}) {
    this.config = {
      apiKey: config.apiKey || '',
      city: config.city || 'Vienna,AT',
      units: config.units || 'metric',
      forecastDays: config.forecastDays || 5,
      showEffects: config.showEffects !== false,
      language: config.language || 'en'
    };

    this.translations = {
      'de': {
        'feels_like': 'Gefühlt',
        'wind': 'Wind',
        'humidity': 'Luftfeuchte',
        'clouds': 'Bewölkung',
        'sunrise': 'Sonnenaufgang',
        'sunset': 'Sonnenuntergang',
        'forecast': 'VORHERSAGE',
        'today': 'HEUTE',
        'tomorrow': 'MORGEN',
        'falling': 'Fallend',
        'rising': 'Steigend',
        'stable': 'Stabil'
      },
      'en': {
        'feels_like': 'Feels like',
        'wind': 'Wind',
        'humidity': 'Humidity',
        'clouds': 'Clouds',
        'sunrise': 'Sunrise',
        'sunset': 'Sunset',
        'forecast': 'FORECAST',
        'today': 'TODAY',
        'tomorrow': 'TOMORROW',
        'falling': 'Falling',
        'rising': 'Rising',
        'stable': 'Stable'
      }
    };

    this.container = null;
    this.weatherData = null;
    this.updateInterval = null;
    this.lastPressure = null;
  }

  get t() {
    return this.translations[this.config.language] || this.translations['en'];
  }

  async render() {
    this.container = document.createElement('div');
    this.container.className = 'module-weather';

    // Hauptbereich mit aktuellen Wetter
    const mainWeather = document.createElement('div');
    mainWeather.className = 'weather-main';
    mainWeather.innerHTML = `
      <div class="weather-current">
        <div class="weather-icon-large">☁️</div>
        <div class="weather-temp-container">
          <div class="weather-temp">-</div>
          <div class="weather-description">-</div>
        </div>
      </div>
      
      <div class="weather-details-grid">
        <div class="weather-detail">
          <span class="detail-icon">🌡️</span>
          <div class="detail-content">
            <div class="detail-label">${this.t.feels_like}</div>
            <div class="detail-value weather-feels-like">-</div>
          </div>
        </div>
        
        <div class="weather-detail">
          <span class="detail-icon">💨</span>
          <div class="detail-content">
            <div class="detail-label">${this.t.wind}</div>
            <div class="detail-value weather-wind">-</div>
            <div class="detail-sublabel weather-wind-direction">-</div>
          </div>
        </div>
        
        <div class="weather-detail">
          <span class="detail-icon">💧</span>
          <div class="detail-content">
            <div class="detail-label">${this.t.humidity}</div>
            <div class="detail-value weather-humidity">-</div>
          </div>
        </div>
        
        <div class="weather-detail">
          <span class="detail-icon">☁️</span>
          <div class="detail-content">
            <div class="detail-label">${this.t.clouds}</div>
            <div class="detail-value weather-clouds">-</div>
          </div>
        </div>
      </div>
      
      <div class="weather-sun-times">
        <div class="sun-time">
          <span class="sun-icon">🌅</span>
          <div class="sun-time-content">
            <div class="sun-time-label">${this.t.sunrise}</div>
            <div class="sun-time-value weather-sunrise">-</div>
          </div>
        </div>
        <div class="sun-time">
          <span class="sun-icon">🌇</span>
          <div class="sun-time-content">
            <div class="sun-time-label">${this.t.sunset}</div>
            <div class="sun-time-value weather-sunset">-</div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(mainWeather);

    // Separator
    const separator = document.createElement('div');
    separator.className = 'weather-separator';
    this.container.appendChild(separator);

    // Ort
    const location = document.createElement('div');
    location.className = 'weather-location';
    location.textContent = this.config.city;
    this.container.appendChild(location);

    // Vorhersage
    const forecastTitle = document.createElement('div');
    forecastTitle.className = 'weather-forecast-title';
    forecastTitle.textContent = this.t.forecast;
    this.container.appendChild(forecastTitle);

    const forecast = document.createElement('div');
    forecast.className = 'weather-forecast';
    this.container.appendChild(forecast);

    // Lade Wetter-Daten
    await this.fetchWeather();
    this.updateInterval = setInterval(() => this.fetchWeather(), 300000); // Alle 5 Minuten

    return this.container;
  }

  async fetchWeather() {
    if (!this.config.apiKey) {
      console.error('OpenWeatherMap API Key fehlt');
      return;
    }

    try {
      // Aktuelles Wetter
      const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${this.config.city}&units=${this.config.units}&appid=${this.config.apiKey}&lang=${this.config.language}`;
      const currentResponse = await fetch(currentUrl);
      const currentData = await currentResponse.json();

      // Vorhersage
      const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${this.config.city}&units=${this.config.units}&appid=${this.config.apiKey}&lang=${this.config.language}`;
      const forecastResponse = await fetch(forecastUrl);
      const forecastData = await forecastResponse.json();

      this.weatherData = {
        current: currentData,
        forecast: forecastData
      };

      this.updateDisplay();

      // Trigger Wetter-Effekte
      if (this.config.showEffects && window.weatherEffects) {
        window.weatherEffects.setEffect(currentData.weather[0].id);
      } else if (window.weatherEffects) {
        window.weatherEffects.stop();
      }
    } catch (error) {
      console.error('Fehler beim Laden der Wetter-Daten:', error);
    }
  }

  updateDisplay() {
    if (!this.weatherData || !this.container) return;

    const current = this.weatherData.current;

    // Temperatur
    const tempElement = this.container.querySelector('.weather-temp');
    if (tempElement) {
      tempElement.textContent = `${Math.round(current.main.temp)}°C`;
    }

    // Wetterbeschreibung
    const descElement = this.container.querySelector('.weather-description');
    if (descElement && current.weather[0].description) {
      descElement.textContent = current.weather[0].description.charAt(0).toUpperCase() + current.weather[0].description.slice(1);
    }

    // Gefühlte Temperatur
    const feelsLikeElement = this.container.querySelector('.weather-feels-like');
    if (feelsLikeElement) {
      feelsLikeElement.textContent = `${Math.round(current.main.feels_like)}°C`;
    }

    // Min/Max Temperatur
    const tempMaxElement = this.container.querySelector('.weather-temp-max');
    if (tempMaxElement) {
      tempMaxElement.textContent = `${Math.round(current.main.temp_max)}°C`;
    }
    const tempMinElement = this.container.querySelector('.weather-temp-min');
    if (tempMinElement) {
      tempMinElement.textContent = `${Math.round(current.main.temp_min)}°C`;
    }

    // Icon
    const iconElement = this.container.querySelector('.weather-icon-large');
    if (iconElement) {
      const icon = this.getWeatherIcon(current.weather[0].main, current.weather[0].id);
      iconElement.textContent = icon;
      const weatherType = this.getWeatherType(current.weather[0].main, current.weather[0].id);
      iconElement.setAttribute('data-weather', weatherType);
    }

    // Wind mit Richtung
    const windElement = this.container.querySelector('.weather-wind');
    if (windElement) {
      windElement.textContent = `${Math.round(current.wind.speed)} m/s`;
    }
    const windDirElement = this.container.querySelector('.weather-wind-direction');
    if (windDirElement && current.wind.deg !== undefined) {
      const direction = this.getWindDirection(current.wind.deg);
      windDirElement.textContent = `${direction} (${current.wind.deg}°)`;
    }

    // Luftfeuchtigkeit
    const humidityElement = this.container.querySelector('.weather-humidity');
    if (humidityElement) {
      humidityElement.textContent = `${current.main.humidity}%`;
    }

    // Luftdruck mit Trend
    const pressureElement = this.container.querySelector('.weather-pressure');
    if (pressureElement) {
      pressureElement.textContent = `${current.main.pressure} hPa`;
    }
    const pressureTrendElement = this.container.querySelector('.weather-pressure-trend');
    if (pressureTrendElement) {
      if (this.lastPressure !== null) {
        const diff = current.main.pressure - this.lastPressure;
        if (diff > 2) {
          pressureTrendElement.textContent = `↗ ${this.t.rising}`;
          pressureTrendElement.style.color = 'var(--accent-cyan)';
        } else if (diff < -2) {
          pressureTrendElement.textContent = `↘ ${this.t.falling}`;
          pressureTrendElement.style.color = 'var(--accent-purple)';
        } else {
          pressureTrendElement.textContent = `→ ${this.t.stable}`;
          pressureTrendElement.style.color = 'var(--text-secondary)';
        }
      } else {
        pressureTrendElement.textContent = `→ ${this.t.stable}`;
      }
      this.lastPressure = current.main.pressure;
    }

    // Sichtweite
    const visibilityElement = this.container.querySelector('.weather-visibility');
    if (visibilityElement) {
      const visKm = current.visibility ? (current.visibility / 1000).toFixed(1) : 'N/A';
      visibilityElement.textContent = `${visKm} km`;
    }

    // Bewölkung
    const cloudsElement = this.container.querySelector('.weather-clouds');
    if (cloudsElement && current.clouds) {
      cloudsElement.textContent = `${current.clouds.all}%`;
    }

    // Sonnenzeiten
    const sunriseElement = this.container.querySelector('.weather-sunrise');
    if (sunriseElement && current.sys.sunrise) {
      const sunrise = new Date(current.sys.sunrise * 1000);
      sunriseElement.textContent = `${sunrise.getHours().toString().padStart(2, '0')}:${sunrise.getMinutes().toString().padStart(2, '0')}`;
    }
    const sunsetElement = this.container.querySelector('.weather-sunset');
    if (sunsetElement && current.sys.sunset) {
      const sunset = new Date(current.sys.sunset * 1000);
      sunsetElement.textContent = `${sunset.getHours().toString().padStart(2, '0')}:${sunset.getMinutes().toString().padStart(2, '0')}`;
    }

    // Ort
    const locationElement = this.container.querySelector('.weather-location');
    if (locationElement) {
      locationElement.textContent = `${current.name.toUpperCase()}, ${current.sys.country}`;
    }

    // Vorhersage
    this.updateForecast();
  }

  getWindDirection(deg) {
    const directions = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  }

  updateForecast() {
    const forecastElement = this.container.querySelector('.weather-forecast');
    if (!forecastElement || !this.weatherData.forecast) return;

    const forecasts = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Gruppiere nach Tagen
    const grouped = {};
    this.weatherData.forecast.list.forEach(item => {
      const date = new Date(item.dt * 1000);
      const dayKey = date.toDateString();
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(item);
    });

    // Berechne Min/Max und Regenwahrscheinlichkeit pro Tag
    Object.values(grouped).slice(0, this.config.forecastDays).forEach((items, index) => {
      const date = new Date(items[0].dt * 1000);

      // Bestimme den Tagnamen
      let dayName;
      const diffDays = Math.round((date.setHours(0, 0, 0, 0) - today) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        dayName = this.t.today;
      } else if (diffDays === 1) {
        dayName = this.t.tomorrow;
      } else {
        dayName = date.toLocaleDateString(this.config.language === 'de' ? 'de-DE' : 'en-US', { weekday: 'short' }).toUpperCase();
      }

      // Berechne Min/Max über den Tag
      const temps = items.map(i => i.main.temp);
      const high = Math.round(Math.max(...temps));
      const low = Math.round(Math.min(...temps));

      // Berechne durchschnittliche Regenwahrscheinlichkeit
      const rainProbs = items.map(i => i.pop || 0);
      const avgRainProb = Math.round((rainProbs.reduce((a, b) => a + b, 0) / rainProbs.length) * 100);

      // Nimm das häufigste Wetter-Icon
      const weatherCounts = {};
      items.forEach(i => {
        const key = i.weather[0].id;
        weatherCounts[key] = (weatherCounts[key] || 0) + 1;
      });
      const mostCommonWeatherId = Object.keys(weatherCounts).reduce((a, b) =>
        weatherCounts[a] > weatherCounts[b] ? a : b
      );
      const mostCommonWeather = items.find(i => i.weather[0].id == mostCommonWeatherId).weather[0];

      forecasts.push({
        day: dayName,
        icon: this.getWeatherIcon(mostCommonWeather.main, mostCommonWeather.id),
        weatherType: this.getWeatherType(mostCommonWeather.main, mostCommonWeather.id),
        high: high,
        low: low,
        rainProb: avgRainProb
      });
    });

    forecastElement.innerHTML = forecasts.map(f => `
      <div class="forecast-day">
        <span class="forecast-day-name">${f.day}</span>
        <span class="forecast-icon" data-weather="${f.weatherType}">${f.icon}</span>
        <div class="forecast-temps">
          <span class="forecast-temp-high">${f.high}°</span>
          <span class="forecast-temp-separator">/</span>
          <span class="forecast-temp-low">${f.low}°</span>
        </div>
        ${f.rainProb > 0 ? `<span class="forecast-rain">💧 ${f.rainProb}%</span>` : '<span class="forecast-rain-placeholder"></span>'}
      </div>
    `).join('');
  }

  getWeatherIcon(main, id) {
    if (id >= 200 && id < 300) return '⛈️';
    if (id >= 300 && id < 400) return '🌦️';
    if (id >= 500 && id < 600) return '🌧️';
    if (id >= 600 && id < 700) return '❄️';
    if (id >= 700 && id < 800) return '🌫️';
    if (id === 800) return '☀️';
    if (id === 801) return '🌤️';
    if (id === 802) return '⛅';
    if (id >= 803) return '☁️';
    return '🌤️';
  }

  getWeatherType(main, id) {
    if (id >= 200 && id < 300) return 'thunderstorm';
    if (id >= 500 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id === 800) return 'sun';
    if (id >= 801) return 'clouds';
    return 'clouds';
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.weather = WeatherModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WeatherModule;
}
