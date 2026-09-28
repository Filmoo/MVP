/**
 * GLSL (WebGL 1 / ES 2.0) for the window backdrop, in two cheap passes:
 *
 * 1. LIGHT, into a tiny texture (1/8 of CSS px), only when the colors or the window size change:
 *    three soft glows (the page light), bent by low-frequency noise, with a faint satin sheen
 *    that only lives in the light. Alpha stores how much light there is.
 * 2. Per render (also on scroll), into the half-resolution canvas:
 *    SHOW upscales the texture (bilinear) with a dither; PANE draws one quad per glass card,
 *    seen through thick glass: its rim bends the light (Snell's law through a curved bezel, the
 *    same optics as the liquid glass over the page, design/liquid/optics.ts, read from a small
 *    lookup texture), splits it a little by colour, and catches it where it faces the light.
 *
 * Per render: no loops; one texture fetch per pixel outside panes, four inside their rim.
 */

import type { Glass } from "../liquid/optics";

/** The thick glass of cards: a squircle rim 18 CSS px wide, 24 px thick (see design/liquid). */
export const CARD_GLASS: Glass = { profile: "squircle", bezel: 18, thickness: 24 };

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** Full-window triangle. */
export const VERTEX_FULL = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAGMENT_LIGHT = `${PRECISION}
uniform float u_scale; // texture px per CSS px
uniform vec2 u_view;   // window, CSS px
uniform vec3 u_bg;
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;
uniform vec2 u_light;  // 0..1, y down

const float CELL = 340.0;   // CSS px per noise cell: low frequency, survives upscaling
const float WARP = 0.045;   // how far the light is pushed around (fraction of the window)
const float SATIN = 0.085;  // pattern depth: +-8.5% of the glow = about 1-2% luminance

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// CSS radial-gradient(r at c, color, transparent stop), with a smooth instead of linear falloff.
float glow(vec2 uv, vec2 c, vec2 r, float stop) {
  return 1.0 - smoothstep(0.0, 1.0, length((uv - c) / r) / stop);
}

void main() {
  // Row 0 of the texture is the top of the window: sampled later with uv = px / view.
  vec2 px = gl_FragCoord.xy / u_scale;
  vec2 q = px / CELL;
  float n1 = noise(q);
  float n2 = noise(q * 2.03 + vec2(7.3, 2.9));
  vec2 uv = px / u_view + (vec2(n1, n2) - 0.5) * WARP;

  float ga = 0.34 * glow(uv, u_light, vec2(0.55, 0.55), 0.72);
  float gb = 0.18 * glow(uv, vec2(1.0 - u_light.x, u_light.y + 0.25), vec2(0.45, 0.50), 0.70);
  float gc = 0.12 * glow(uv, vec2(1.0 - u_light.x, 1.10), vec2(0.70, 0.45), 0.70);

  // Satin: soft bands along the noise's level sets, faded in and out by the noise itself so they
  // read as a sheen on fabric, not as contour lines.
  float n = n1 * 0.65 + n2 * 0.35;
  float satin = 1.0 + SATIN * sin(n * 21.0) * smoothstep(0.25, 0.75, n2);

  vec3 col = u_bg;
  col = mix(col, u_c, gc * satin);
  col = mix(col, u_b, gb * satin);
  col = mix(col, u_a, ga * satin);
  gl_FragColor = vec4(col, clamp((ga + gb + gc) * 2.0, 0.0, 1.0));
}
`;

/** Size of the optics lookup texture (see design/liquid/optics.ts `opticsTable`). */
export const OPTICS_SIZE = 64;

const SURFACE = `
uniform sampler2D u_tex; // the light (pass 1)
uniform vec2 u_view;

// The backdrop at a point (CSS px): the light. a = how much light is there.
vec4 surface(vec2 px) {
  return texture2D(u_tex, px / u_view);
}

// Triangular dither (+-1 step): hides 8-bit banding in the long dark gradients.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float dither(vec2 fc) { return (ign(fc) + ign(fc + vec2(47.0, 17.0)) - 1.0) / 255.0; }
`;

export const FRAGMENT_SHOW = `${PRECISION}
uniform vec2 u_res; // canvas px
${SURFACE}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res * u_view;
  gl_FragColor = vec4(surface(px).rgb + dither(gl_FragCoord.xy), 1.0);
}
`;

/** One quad per pane; attributes carry the pane, so all panes go in a single draw call. */
export const VERTEX_PANE = `
attribute vec2 a_pos;   // CSS px, y down
attribute vec4 a_rect;  // center, half size (CSS px)
attribute vec2 a_shape; // corner radius (CSS px), strength
uniform vec2 u_view;
varying vec2 v_px;
varying vec4 v_rect;
varying vec2 v_shape;
void main() {
  v_px = a_pos;
  v_rect = a_rect;
  v_shape = a_shape;
  gl_Position = vec4(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0, 0.0, 1.0);
}
`;

export const FRAGMENT_PANE = `${PRECISION}
${SURFACE}
uniform sampler2D u_optics; // r = inward displacement / u_bend, g = reflectance, across the bezel
uniform float u_bend;       // CSS px of the largest displacement
uniform vec3 u_bg;
uniform vec3 u_a;
uniform vec2 u_lightAt;     // where the page light comes from, CSS px
varying vec2 v_px;
varying vec4 v_rect;
varying vec2 v_shape;

const float BEVEL = ${CARD_GLASS.bezel.toFixed(1)}; // CSS px of the glass edge that bends the light
const float SPLIT = 0.12;   // colour split at the rim: blue bends 12% more than green, red 12% less
const float GATHER = 0.5;   // light gathered by the rim, as a share of the light behind it
const float SHEEN = 0.06;   // rim light where the edge faces the page light

void main() {
  vec2 p = v_px - v_rect.xy;
  float radius = v_shape.x;
  float strength = v_shape.y;
  // The pane's outline: outside its rounded corners the plain backdrop stays.
  vec2 qa = abs(p) - v_rect.zw + radius;
  if (length(max(qa, 0.0)) + min(max(qa.x, qa.y), 0.0) - radius > 0.0) discard;

  // The optical outline: corners rounded at least as much as the bevel is wide, so the rim's
  // normal turns smoothly instead of creasing along the corner's diagonal.
  float bevel = min(BEVEL, min(v_rect.z, v_rect.w));
  float r = min(min(v_rect.z, v_rect.w), max(radius, bevel));
  vec2 q = abs(p) - v_rect.zw + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  vec2 nq = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 normal = nq * vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);

  // Across the bevel (t = 0 at the rim, 1 where the top is flat): how far inward the light seen
  // here comes from, and how much the surface reflects.
  float t = clamp(-d / bevel, 0.0, 1.0);
  vec2 optics = texture2D(u_optics, vec2((t * ${OPTICS_SIZE - 1}.0 + 0.5) / ${OPTICS_SIZE}.0, 0.5)).rg;
  vec2 bend = -normal * optics.r * u_bend * strength;
  vec4 green = surface(v_px + bend);
  vec3 col = vec3(surface(v_px + bend * (1.0 - SPLIT)).r, green.g, surface(v_px + bend * (1.0 + SPLIT)).b);

  // The rim gathers the light it bends (only where there is light), and catches the page light
  // on the side facing it: a thick, polished edge.
  float edge = 1.0 - t;
  float band = edge * edge * edge;
  col += (col - u_bg) * band * GATHER * strength;
  vec2 toLight = normalize(u_lightAt - v_rect.xy + vec2(0.0, 0.001));
  float facing = smoothstep(-0.35, 1.0, dot(normal, toLight));
  float rim = max(optics.g, band * band) * facing;
  col += rim * SHEEN * strength * (u_a * (0.4 + green.a) + 0.35);
  gl_FragColor = vec4(col + dither(gl_FragCoord.xy), 1.0);
}
`;
