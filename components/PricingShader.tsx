"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PricingShader — page-local, decorative WebGL background for /pricing ONLY.
 *
 * Rendered inside PricingPage as a fixed, pointer-events-none, aria-hidden
 * layer (NOT in app/layout.tsx, NOT a global background). It visually covers
 * the global SpaceBackground on this route only; everywhere else the global
 * background is untouched because this component simply isn't mounted there.
 *
 * Lionade-recolored: deep navy void (#04080F) → electric (#4A90D9) flow →
 * sparse gold (#FFD700) wisps. No hue cycling / rainbow.
 *
 * Theme detection is Lionade-correct: dark is the DEFAULT, light is the
 * `html.light` class (Lionade does NOT use a `.dark` class). A
 * MutationObserver on <html> reacts to live theme toggles.
 *
 * prefers-reduced-motion: WebGL + rAF are NOT initialised at all; a static
 * Lionade gradient is rendered instead. The media query is also observed so
 * the page reacts if the user changes the OS setting live.
 *
 * Cleanup: cancelAnimationFrame, resize listener removed, MutationObserver
 * disconnected, GL program/buffer deleted, context lost — no leaks on
 * route change / unmount.
 */

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Lionade palette ramp. Smooth fractal-ish field → navy→electric→gold mix.
const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_light; // 0 = dark (default), 1 = html.light

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
    mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 5; k++){
    v += a * noise(p);
    p = p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv;
  p.x *= u_res.x / u_res.y;

  float t = u_time * 0.045;
  float flow = fbm(p * 2.3 + vec2(t, t * 0.6));
  flow += 0.5 * fbm(p * 4.6 - vec2(t * 0.7, t));

  // Lionade ramp — no hue rotation.
  vec3 navy     = vec3(0.016, 0.031, 0.059); // #04080F
  vec3 deep     = vec3(0.039, 0.078, 0.156); // #0a1428 depth
  vec3 electric = vec3(0.290, 0.565, 0.851); // #4A90D9
  vec3 gold     = vec3(1.000, 0.843, 0.000); // #FFD700

  float band = smoothstep(0.30, 0.95, flow);
  vec3 col = mix(navy, deep, smoothstep(0.0, 0.45, flow));
  col = mix(col, electric, band * 0.55);

  // Sparse gold wisps — capped low so it reads as gold dust, not rainbow.
  float gleam = pow(smoothstep(0.78, 1.0, flow), 3.0);
  col = mix(col, gold, gleam * 0.15);

  // Soft top vignette toward the page void.
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.85, 1.0 - uv.y));

  float alpha = 0.9;

  // Light theme: lerp toward warm cream (#FFFBF0), drop opacity so it sits
  // quietly behind a bright page instead of muddying it.
  if (u_light > 0.5) {
    vec3 cream = vec3(1.000, 0.984, 0.941);
    col = mix(col, cream, 0.82);
    alpha = 0.16;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isLightTheme(): boolean {
  if (typeof document === "undefined") return false;
  // Lionade: dark is DEFAULT, light is the `html.light` class.
  return document.documentElement.classList.contains("light");
}

export default function PricingShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);
  const [light, setLight] = useState<boolean>(false);

  // Track reduced-motion live (OS setting can flip while page is open).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Track light/dark theme for the static fallback (the WebGL path observes
  // its own copy so it can update the uniform without a React re-render).
  useEffect(() => {
    setLight(isLightTheme());
    const obs = new MutationObserver(() => setLight(isLightTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    // Reduced motion → never init WebGL/rAF. Static fallback handles visuals.
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", { antialias: true, alpha: true }) as
        | WebGLRenderingContext
        | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return; // No WebGL → CSS fallback layer underneath shows.

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uLight = gl.getUniformLocation(prog, "u_light");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    // Shader reads theme via its own observer → no React re-render needed.
    let lightFlag = isLightTheme() ? 1 : 0;
    const themeObs = new MutationObserver(() => {
      lightFlag = isLightTheme() ? 1 : 0;
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uLight, lightFlag);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      themeObs.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    };
  }, [reduced]);

  // Static Lionade gradient — the reduced-motion fallback AND the base layer
  // behind the canvas (covers no-WebGL + first paint).
  const staticBg = light
    ? "radial-gradient(ellipse at 50% 0%, #FFFFFF 0%, #FFFBF0 70%)"
    : "radial-gradient(ellipse at 50% 0%, #0a1428 0%, #04080F 70%)";

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
    >
      <div className="absolute inset-0" style={{ background: staticBg }} />
      {!light && (
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at 82% 12%, rgba(255,215,0,0.10) 0%, transparent 45%)",
          }}
        />
      )}
      {!reduced && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />
      )}
    </div>
  );
}
