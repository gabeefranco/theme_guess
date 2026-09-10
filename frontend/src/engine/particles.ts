// Lightweight juice: click ripples, color-apply bursts, and a confetti
// rain for a strong reveal. All drawn straight onto the game canvas.

const CONFETTI_COLORS = ['#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#fe8019'];

interface Ripple {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  gravity: number;
  color: string;
  confetti: boolean;
  rot: number;
  vr: number;
}

export class ParticleSystem {
  private ripples: Ripple[] = [];
  private particles: Particle[] = [];

  spawnRipple(x: number, y: number, color = '#ebdbb2'): void {
    this.ripples.push({ x, y, r: 2, maxR: 46, life: 1, color });
  }

  spawnBurst(x: number, y: number, color: string, count = 14): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 110;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 1.1 + Math.random() * 0.7,
        size: 1.5 + Math.random() * 2.5,
        gravity: 90,
        color,
        confetti: false,
        rot: 0,
        vr: 0,
      });
    }
  }

  spawnConfetti(count: number, width: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * width,
        y: -20 - Math.random() * 240,
        vx: (Math.random() - 0.5) * 70,
        vy: 70 + Math.random() * 90,
        life: 1,
        decay: 0.12 + Math.random() * 0.1,
        confetti: true,
        size: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 7,
        gravity: 40,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
  }

  clear(): void {
    this.particles.length = 0;
    this.ripples.length = 0;
  }

  update(dtMs: number): void {
    const s = dtMs / 1000;
    for (const r of this.ripples) {
      r.r += (r.maxR - r.r) * 0.18;
      r.life -= s * 1.6;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);

    for (const p of this.particles) {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vy += p.gravity * s;
      if (p.confetti) p.rot += p.vr * s;
      p.life -= p.decay * s;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const r of this.ripples) {
      ctx.globalAlpha = Math.max(r.life, 0) * 0.6;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      if (p.confetti) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
