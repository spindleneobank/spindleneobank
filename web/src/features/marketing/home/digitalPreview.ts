/**
 * Port of the old site's digital-previews.js: an opaque pixel field covers a sharp sample dashboard; the pointer erases
 * grid cells around it (destination-out), eased in and out. Constants are the original ones.
 * Returns a dispose function.
 */
export function mountDigitalPreview(host: HTMLElement): () => void {
  const img = host.querySelector('img');
  if (!img || host.querySelector('.sp-digital-lens')) return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'sp-digital-lens';
  canvas.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('iframe');
  frame.className = 'sp-preview-live';
  frame.title = 'Illustrative Spindle dashboard';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.loading = 'lazy';
  const hint = document.createElement('span');
  hint.className = 'sp-preview-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.innerHTML = '<span>MOVE TO DECODE</span><span>OPEN DASHBOARD ↗</span>';
  host.append(frame, canvas, hint);
  const ctx = canvas.getContext('2d', { alpha: true });
  const field = document.createElement('canvas');
  const fctx = field.getContext('2d', { alpha: false });
  const sample = document.createElement('canvas');
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  const cleanup = () => {
    frame.remove();
    canvas.remove();
    hint.remove();
  };
  if (!ctx || !fctx || !sctx) {
    cleanup();
    return () => {};
  }
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const small = matchMedia('(max-width:809px)');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let cell = 10;
  let sw = 0;
  let sh = 0;
  let pixels: Uint8ClampedArray | null = null;
  let x = 0;
  let y = 0;
  let tx = 0;
  let ty = 0;
  let strength = 0;
  let target = 0;
  let raf = 0;
  let last = 0;
  let fieldTime = Number.NEGATIVE_INFINITY;
  let inView = false;
  let disposed = false;
  const tones: number[][] = [
    [106, 85, 115],
    [166, 101, 96],
    [164, 124, 83],
    [123, 105, 155],
    [157, 98, 126],
  ];
  const glyphs = '01░01:+▒01';

  // The live sample dashboard document is not part of this site; the 1920px fallback image carries the same UI.
  const loadFrame = () => {};
  const ready = (e: MessageEvent) => {
    if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.type === 'spindle:preview-ready')
      host.classList.add('sp-has-live');
  };

  function buildField(now: number) {
    if (!w || !h || !fctx) return;
    const time = reduce.matches ? 0 : now * 0.001;
    fieldTime = now;
    fctx.fillStyle = '#e8dfdc';
    fctx.fillRect(0, 0, w, h);
    fctx.font = `${Math.max(7, cell - 2)}px 'IBM Plex Mono',monospace`;
    fctx.textAlign = 'center';
    fctx.textBaseline = 'middle';
    for (let cy = 0; cy < sh; cy++)
      for (let cx = 0; cx < sw; cx++) {
        const i = (cy * sw + cx) * 4;
        const hash = (cx * 23 + cy * 41) % 101;
        const lum = pixels ? ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 765 : 0.65;
        const wave = 0.5 + 0.5 * Math.sin(cx * 0.16 + cy * 0.105 - time * 0.65);
        const stream = (cy + Math.floor(time * 2) + cx * 13) % 37;
        const tone = tones[(cx + Math.floor(cy / 7)) % 5] as number[];
        const depth = (1 - lum) * 0.12 + 0.04 + wave * 0.04;
        fctx.fillStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${depth.toFixed(3)})`;
        fctx.fillRect(cx * cell, cy * cell, cell - 1, cell - 1);
        const glow = (stream < 3 ? 0.88 : 0.23 + wave * 0.19) * (lum > 0.82 ? 0.62 : 1);
        fctx.fillStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${glow.toFixed(3)})`;
        fctx.fillText(glyphs.charAt((hash + Math.floor(time * 0.7)) % glyphs.length), cx * cell + cell * 0.5, cy * cell + cell * 0.52);
        if (lum < 0.55 && hash % 4 === 0) {
          fctx.fillStyle = '#a0667470';
          fctx.fillRect(cx * cell + 1, cy * cell + 1, 2, 2);
        }
      }
  }

  function paint(now: number) {
    if (!w || !h || !ctx) return;
    const period = small.matches ? 360 : 190;
    if (!reduce.matches && now - fieldTime > period) buildField(now);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(field, 0, 0, w, h);
    if (strength < 0.01) return;
    const radius = Math.min(157, Math.max(65, w * 0.19));
    ctx.globalCompositeOperation = 'destination-out';
    for (let gx = Math.floor((x - radius) / cell) * cell; gx < x + radius; gx += cell)
      for (let gy = Math.floor((y - radius) / cell) * cell; gy < y + radius; gy += cell) {
        const d = Math.hypot(gx + cell / 2 - x, gy + cell / 2 - y) / radius;
        if (d > 1) continue;
        const a = strength * Math.min(1, (1 - d) / 0.19);
        ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
        ctx.fillRect(gx, gy, cell + 0.1, cell + 0.1);
      }
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick(now: number) {
    raf = 0;
    if (disposed || !inView || document.hidden) return;
    const interval = small.matches ? 50 : 33;
    if (last && now - last < interval) {
      raf = requestAnimationFrame(tick);
      return;
    }
    last = now;
    x += (tx - x) * 0.28;
    y += (ty - y) * 0.28;
    strength += (target - strength) * 0.22;
    if (Math.abs(target - strength) < 0.008) strength = target;
    paint(now);
    if (!reduce.matches || strength !== target) raf = requestAnimationFrame(tick);
  }
  function wake() {
    if (raf || !inView || document.hidden || disposed) return;
    last = 0;
    if (reduce.matches) {
      strength = target;
      x = tx;
      y = ty;
      paint(0);
    } else raf = requestAnimationFrame(tick);
  }
  function resize() {
    const r = host.getBoundingClientRect();
    w = r.width;
    h = r.height;
    if (!w || !h || !ctx || !fctx || !sctx || !img) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cell = w < 500 ? 8 : 10;
    sw = Math.ceil(w / cell);
    sh = Math.ceil(h / cell);
    canvas.width = field.width = Math.round(w * dpr);
    canvas.height = field.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    frame.style.width = '1920px';
    frame.style.height = `${((1920 * h) / w).toFixed(2)}px`;
    frame.style.transform = `scale(${w / 1920})`;
    if (img.complete && img.naturalWidth) {
      sample.width = sw;
      sample.height = sh;
      const fit = getComputedStyle(img).objectFit;
      const k =
        fit === 'contain'
          ? Math.min(sw / img.naturalWidth, sh / img.naturalHeight)
          : Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
      sctx.clearRect(0, 0, sw, sh);
      sctx.drawImage(img, (sw - img.naturalWidth * k) / 2, (sh - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      try {
        pixels = sctx.getImageData(0, 0, sw, sh).data;
      } catch {
        pixels = null;
      }
    }
    buildField(0);
    paint(0);
    host.dataset.spDigitalReady = 'true';
    wake();
  }
  function point(e: PointerEvent) {
    const r = host.getBoundingClientRect();
    tx = e.clientX - r.left;
    ty = e.clientY - r.top;
    if (!target) {
      x = tx;
      y = ty;
    }
    target = 1;
    host.classList.add('is-decoding');
    if (reduce.matches) {
      x = tx;
      y = ty;
      strength = 1;
      paint(0);
    } else wake();
  }
  function leave() {
    target = 0;
    host.classList.remove('is-decoding');
    if (reduce.matches) {
      strength = 0;
      paint(0);
    } else wake();
  }
  function focus() {
    tx = x = w * 0.5;
    ty = y = h * 0.48;
    target = 1;
    host.classList.add('is-decoding');
    wake();
  }
  const touch = (e: PointerEvent) => {
    if (e.pointerType === 'touch') point(e);
  };
  function preference() {
    cancelAnimationFrame(raf);
    raf = 0;
    buildField(0);
    wake();
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  }
  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries[0]?.isIntersecting === true;
      if (inView) {
        loadFrame();
        wake();
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0 },
  );
  observer.observe(host);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  img.addEventListener('load', resize);
  host.addEventListener('pointermove', point, { passive: true });
  host.addEventListener('pointerdown', touch, { passive: true });
  host.addEventListener('pointerleave', leave);
  host.addEventListener('pointercancel', leave);
  host.addEventListener('focus', focus);
  host.addEventListener('blur', leave);
  window.addEventListener('message', ready);
  document.addEventListener('visibilitychange', visibility);
  reduce.addEventListener('change', preference);
  resize();
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    ro.disconnect();
    img.removeEventListener('load', resize);
    host.removeEventListener('pointermove', point);
    host.removeEventListener('pointerdown', touch);
    host.removeEventListener('pointerleave', leave);
    host.removeEventListener('pointercancel', leave);
    host.removeEventListener('focus', focus);
    host.removeEventListener('blur', leave);
    window.removeEventListener('message', ready);
    document.removeEventListener('visibilitychange', visibility);
    reduce.removeEventListener('change', preference);
    host.classList.remove('sp-has-live', 'is-decoding');
    delete host.dataset.spDigitalReady;
    cleanup();
  };
}
