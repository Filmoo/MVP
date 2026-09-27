/**
 * GLSL (WebGL 1 / ES 2.0) for the window backdrop, in two cheap passes:
 *
 * 1. LIGHT, into a tiny texture (1/8 of CSS px), only when the colors or the window size change:
 *    three soft glows (the page light), bent by low-frequency noise, with a faint satin pattern
 *    that only lives in the light. Alpha stores how much light there is.
 * 2. Per render (also on scroll), into the half-resolution canvas:
 *    SHOW upscales the texture (bilinear) with a fine texture and a dither; PANE draws one quad
 *    per glass element, sampling both at bent coordinates (lens + bevel) with a faint rim light.
 *
 * The fine texture is a soft hex mosaic (a nod to hextech), a 128² tile rendered ONCE by PATTERN.
 * It only scales the light's difference from the background, so dark areas never carry it.
 *
 * Per render: no loops, two texture fetches per pixel; the noise lives in pass 1 only.
 */

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

/** Size of the pattern tile, texels (power of two: it repeats). */
export const PATTERN_SIZE = 128;

/** Rendered once: a soft mosaic of staggered (hex-like) cells, each a random shade, tiling. */
export const FRAGMENT_PATTERN = `${PRECISION}
const float N = ${PATTERN_SIZE}.0;
const float CELL = 8.0; // texels between cell centers; N / CELL rows is even, so it tiles

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 t = gl_FragCoord.xy;
  vec2 base = floor(t / CELL);
  float d1 = 1e9;
  float d2 = 1e9;
  float v1 = 0.5;
  float v2 = 0.5;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec2 center = (c + vec2(0.5 + 0.5 * mod(c.y, 2.0), 0.5)) * CELL;
      float d = length((t - center) * vec2(1.0, 1.15));
      float v = hash(mod(c, N / CELL) + 0.37);
      if (d < d1) { d2 = d1; v2 = v1; d1 = d; v1 = v; }
      else if (d < d2) { d2 = d; v2 = v; }
    }
  }
  // Soft seams: neighbouring shades blend, so no outline (no lines) is ever drawn.
  float v = mix((v1 + v2) * 0.5, v1, smoothstep(0.0, 3.0, d2 - d1));
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const SURFACE = `
uniform sampler2D u_tex;     // the light (pass 1)
uniform sampler2D u_pattern; // the mosaic tile
uniform vec2 u_view;
uniform vec3 u_bg;
const float PATTERN_PX = 2.0; // CSS px per pattern texel: cells of about 16 CSS px
const float GRAIN = 0.2;      // mosaic depth: +-10% of the light = about 1-2% luminance at most

// The backdrop at a point (CSS px): the light with the mosaic in it. a = how much light is there.
vec4 surface(vec2 px) {
  vec4 light = texture2D(u_tex, px / u_view);
  float cell = texture2D(u_pattern, px / (${PATTERN_SIZE}.0 * PATTERN_PX)).r - 0.5;
  return vec4(u_bg + (light.rgb - u_bg) * (1.0 + cell * GRAIN), light.a);
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
uniform vec3 u_a;
varying vec2 v_px;
varying vec4 v_rect;
varying vec2 v_shape;

const float BEVEL = 22.0; // CSS px of the glass edge that bends the light
const float BEND = 26.0;  // CSS px of displacement at the very edge
const float LENS = 0.035; // magnification across a pane
const float RIM = 0.05;   // rim light at the edge
const float GATHER = 0.55; // light gathered in the bevel, as a share of the light there

void main() {
  vec2 p = v_px - v_rect.xy;
  float radius = v_shape.x;
  float strength = v_shape.y;
  // Rounded-rect distance (negative inside) and its outward normal.
  vec2 q = abs(p) - v_rect.zw + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  if (d > 0.0) discard; // outside the rounded corners: the plain backdrop stays
  vec2 nq = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 normal = nq * sign(p);

  // Lens: a slight magnification across the pane, and the light pulled in from beyond the edge
  // through the bevel, like thick glass.
  float bevel = min(BEVEL, min(v_rect.z, v_rect.w) * 0.5);
  float edge = 1.0 - smoothstep(0.0, bevel, -d);
  float e2 = edge * edge;
  vec2 at = v_rect.xy + p * (1.0 - LENS * strength) + normal * e2 * BEND * strength;
  vec4 light = surface(at);

  // The bevel gathers the light it bends (only where there is light), and a faint rim catches
  // it, stronger on top (lit from above).
  vec3 col = light.rgb + (light.rgb - u_bg) * e2 * GATHER * strength;
  float rim = (1.0 - smoothstep(0.0, 3.0, -d)) * (0.55 - 0.45 * normal.y);
  col += rim * RIM * strength * (u_a * light.a * 0.5 + 0.35);
  gl_FragColor = vec4(col + dither(gl_FragCoord.xy), 1.0);
}
`;
