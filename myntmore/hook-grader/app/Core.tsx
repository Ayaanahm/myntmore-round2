"use client";

// Particle core behind the page. One canvas, a few thousand points.
// mode: "hero" big sphere rising from the bottom, "side" smaller sphere to the right,
// "result" sphere tinted by the score. Points ease between modes.
import { useEffect, useRef } from "react";

type Mode = "hero" | "side" | "result";

export default function Core({ mode, score }: { mode: Mode; score?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ mode, score: score ?? 0 });
  state.current = { mode, score: score ?? 0 };

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, D = 1, raf = 0;
    type P = { a: number; b: number; s: number; x: number; y: number };
    let pts: P[] = [];
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    const build = () => {
      D = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      cv.width = W * D; cv.height = H * D;
      const n = W < 700 ? 2600 : 6500;
      if (pts.length !== n) {
        seed = 42;
        pts = Array.from({ length: n }, () => ({ a: rnd() * Math.PI * 2, b: Math.acos(2 * rnd() - 1), s: rnd(), x: W / 2, y: H / 2 }));
      }
    };
    build();
    addEventListener("resize", build);

    // eased layout values
    let cx = W / 2, cy = H * 0.95, R = Math.min(W * 0.36, H * 0.58), warm = -1;
    const t0 = performance.now();

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const { mode, score } = state.current;
      const mob = W < 760;
      const goal =
        mode === "hero"
          ? { cx: W / 2, cy: H * (mob ? 0.9 : 0.96), R: mob ? W * 0.62 : Math.min(W * 0.36, H * 0.58) }
          : mob
            ? { cx: W * 0.5, cy: H * 1.05, R: W * 0.5 }
            : { cx: W * 0.86, cy: H * 0.55, R: Math.min(W * 0.2, H * 0.36) };
      const k = reduce ? 1 : 0.05;
      cx += (goal.cx - cx) * k; cy += (goal.cy - cy) * k; R += (goal.R - R) * k;
      // colour: bright spectrum by default; result mode tints by score (1 green, 0.55 amber, 0 red)
      const target = mode === "result" ? (score >= 80 ? 1 : score >= 55 ? 0.55 : 0) : -1;
      warm += (target - warm) * (reduce ? 1 : 0.04);

      ctx.setTransform(D, 0, 0, D, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const rot = t * 0.05;
      const intro = reduce ? 1 : Math.min(1, t / 2.4);
      const ie = 1 - Math.pow(1 - intro, 3);

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const sx = Math.sin(p.b) * Math.cos(p.a + rot);
        const sy = Math.cos(p.b);
        const sz = Math.sin(p.b) * Math.sin(p.a + rot);
        let px = cx + R * sx, py = cy + R * sy;
        if (ie < 1) {
          const ox = W / 2 + (p.s - 0.5) * W * 1.4, oy = H / 2 + (((i * 7919) % 1000) / 1000 - 0.5) * H * 1.4;
          px = ox + (px - ox) * ie; py = oy + (py - oy) * ie;
        }
        const depth = (sz + 1) / 2;
        const lit = Math.max(0, -0.55 * sx - 0.6 * sy + 0.58 * sz);
        const rim = Math.pow(1 - Math.abs(sz), 3);
        const al = Math.min(1, (0.3 + 0.8 * depth) * (0.5 + 0.6 * Math.max(lit, rim * 0.8)));
        let r: number, g: number, b: number;
        if (warm < -0.5) {
          // spectrum around the sphere: indigo -> cyan -> pink
          const h = (p.a / (Math.PI * 2) + p.b / Math.PI * 0.35 + t * 0.01) % 1;
          const stops = [[79, 70, 229], [6, 182, 212], [236, 72, 153], [79, 70, 229]];
          const f = h * 3, i0 = Math.floor(f), m = f - i0;
          const c0 = stops[i0], c1 = stops[i0 + 1];
          r = c0[0] + (c1[0] - c0[0]) * m; g = c0[1] + (c1[1] - c0[1]) * m; b = c0[2] + (c1[2] - c0[2]) * m;
        } else {
          const w = Math.max(0, warm);
          // 0 red (239,68,68) -> 0.55 amber (245,158,11) -> 1 green (16,185,129)
          if (w < 0.55) { const m = w / 0.55; r = 239 + 6 * m; g = 68 + 90 * m; b = 68 - 57 * m; }
          else { const m = (w - 0.55) / 0.45; r = 245 - 229 * m; g = 158 + 27 * m; b = 11 + 118 * m; }
        }
        r = r * (0.75 + 0.25 * lit); g = g * (0.75 + 0.25 * lit); b = b * (0.75 + 0.25 * lit);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${al})`;
        const sz2 = 1 + depth * 1.4;
        ctx.fillRect(px, py, sz2, sz2);
      }
      // soft bloom
      const gr = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.35, 0, cx, cy, R * 1.25);
      gr.addColorStop(0, warm < -0.5 ? "rgba(129,140,248,0.16)" : "rgba(255,255,255,0.12)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", build); };
  }, []);

  return (
    <>
      <canvas ref={ref} className="scene" aria-hidden="true" />
      <div className="veil" aria-hidden="true" />
    </>
  );
}
