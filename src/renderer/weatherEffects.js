class WeatherEffects {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.animationId = null;
    this.currentEffect = null;
    this.particles = [];
  }

  init() {
    // Erstelle Canvas für Wetter-Effekte
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'weather-effects-canvas';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '9999';
    this.canvas.style.opacity = '0.3';
    document.body.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setEffect(weatherCode) {
    // Stoppe aktuelle Animation
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.particles = [];
    }

    // Bestimme Effekt basierend auf Wetter-Code
    if (weatherCode >= 200 && weatherCode < 300) {
      this.currentEffect = 'thunderstorm';
    } else if (weatherCode >= 500 && weatherCode < 600) {
      this.currentEffect = 'rain';
    } else if (weatherCode >= 600 && weatherCode < 700) {
      this.currentEffect = 'snow';
    } else if (weatherCode === 800) {
      this.currentEffect = 'sun';
    } else {
      this.currentEffect = null;
    }

    if (this.currentEffect) {
      this.startAnimation();
    }
  }

  startAnimation() {
    const animate = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      switch (this.currentEffect) {
        case 'rain':
          this.animateRain();
          break;
        case 'snow':
          this.animateSnow();
          break;
        case 'sun':
          this.animateSun();
          break;
        case 'thunderstorm':
          this.animateThunderstorm();
          break;
      }

      this.animationId = requestAnimationFrame(animate);
    };

    animate();
  }

  animateRain() {
    // Erstelle neue Tropfen
    if (this.particles.length < 150) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * -this.canvas.height,
        speed: 10 + Math.random() * 15,
        length: 20 + Math.random() * 30,
        opacity: 0.1 + Math.random() * 0.4
      });
    }

    // Zeichne und bewege Tropfen
    this.ctx.strokeStyle = '#00D4FF';
    this.ctx.lineWidth = 1;

    this.particles = this.particles.filter(particle => {
      this.ctx.globalAlpha = particle.opacity;
      this.ctx.beginPath();
      this.ctx.moveTo(particle.x, particle.y);
      this.ctx.lineTo(particle.x + 1, particle.y + particle.length);
      this.ctx.stroke();

      particle.y += particle.speed;
      particle.x += 1; // Leichter schräger Regen

      if (particle.y > this.canvas.height) {
        particle.y = -particle.length;
        particle.x = Math.random() * this.canvas.width;
      }
      return true;
    });
    this.ctx.globalAlpha = 1.0;
  }

  animateSnow() {
    // Erstelle neue Schneeflocken
    if (this.particles.length < 100) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * -this.canvas.height,
        speed: 1 + Math.random() * 2,
        size: 1 + Math.random() * 3,
        sway: Math.random() * 2 - 1,
        angle: Math.random() * Math.PI * 2,
        opacity: 0.2 + Math.random() * 0.7
      });
    }

    // Zeichne und bewege Schneeflocken
    this.ctx.fillStyle = '#FFFFFF';
    this.particles = this.particles.filter(particle => {
      this.ctx.globalAlpha = particle.opacity;
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fill();

      particle.y += particle.speed;
      particle.angle += 0.02;
      particle.x += Math.sin(particle.angle) * 0.5 + particle.sway * 0.3;

      if (particle.y > this.canvas.height) {
        particle.y = -10;
        particle.x = Math.random() * this.canvas.width;
      }
      return true;
    });
    this.ctx.globalAlpha = 1.0;
  }

  animateSun() {
    // Sonnenstrahlen von oben rechts
    const centerX = this.canvas.width * 0.85;
    const centerY = this.canvas.height * 0.15;
    const numRays = 8;

    this.ctx.strokeStyle = '#FFD700';
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.4;

    for (let i = 0; i < numRays; i++) {
      const angle = (Math.PI * 2 * i) / numRays;
      const length = 200 + Math.sin(Date.now() / 1000 + i) * 50;
      const endX = centerX + Math.cos(angle) * length;
      const endY = centerY + Math.sin(angle) * length;

      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(endX, endY);
      this.ctx.stroke();
    }

    this.ctx.globalAlpha = 1.0;
  }

  animateThunderstorm() {
    // Zufällige Blitze
    if (Math.random() < 0.02) {
      const x = Math.random() * this.canvas.width;
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.globalAlpha = 0.9;
      this.ctx.fillRect(x - 2, 0, 4, this.canvas.height);
      this.ctx.globalAlpha = 1.0;

      // Blitz verschwindet schnell
      setTimeout(() => {
        this.ctx.clearRect(x - 2, 0, 4, this.canvas.height);
      }, 100);
    }
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.particles = [];
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

// Browser-Check
if (typeof window !== 'undefined') {
  window.WeatherEffects = WeatherEffects;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WeatherEffects;
}
