import { opticsTable } from "../liquid/optics";
import { CARD_GLASS, FRAGMENT_LIGHT, FRAGMENT_PANE, FRAGMENT_SHOW, OPTICS_SIZE, VERTEX_FULL, VERTEX_PANE } from "./shader";
import { type Frame, type Light, PANE_STRIDE, sameLight } from "./uniforms";

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

/**
 * Thin WebGL 1 wrapper for the two passes (see shader.ts). Draws only when asked; the light
 * texture is redrawn only when the light or its size changed.
 */
export class Renderer {
  private light: Program | null = null;
  private show: Program | null = null;
  private pane: Program | null = null;
  private full: WebGLBuffer | null = null;
  private panes: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private optics: WebGLTexture | null = null;
  /** CSS px of the largest displacement the optics texture stands for. */
  private bend = 0;
  private framebuffer: WebGLFramebuffer | null = null;
  private textureSize = { width: 0, height: 0 };
  private drawnLight: Light | undefined;

  private constructor(
    readonly gl: WebGLRenderingContext,
    readonly canvas: HTMLCanvasElement,
  ) {}

  /** `null` when WebGL is unavailable or the programs don't build. */
  static create(canvas: HTMLCanvasElement): Renderer | null {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const renderer = new Renderer(gl, canvas);
    return renderer.setup() ? renderer : null;
  }

  /** (Re)builds GPU state; also after a lost context comes back. */
  setup(): boolean {
    const { gl } = this;
    const compile = (vertex: string, fragment: string, attributes: string[]): Program | null => {
      const shader = (type: number, source: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      };
      const vs = shader(gl.VERTEX_SHADER, vertex);
      const fs = shader(gl.FRAGMENT_SHADER, fragment);
      const program = gl.createProgram();
      if (!vs || !fs || !program) return null;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      for (const [i, name] of attributes.entries()) gl.bindAttribLocation(program, i, name);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      const cache = new Map<string, WebGLUniformLocation | null>();
      return {
        program,
        uniform: (name) => {
          if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
          return cache.get(name) ?? null;
        },
      };
    };
    this.light = compile(VERTEX_FULL, FRAGMENT_LIGHT, ["a_pos"]);
    this.show = compile(VERTEX_FULL, FRAGMENT_SHOW, ["a_pos"]);
    this.pane = compile(VERTEX_PANE, FRAGMENT_PANE, ["a_pos", "a_rect", "a_shape"]);
    if (!this.light || !this.show || !this.pane) return false;

    this.full = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.panes = gl.createBuffer();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const texture = (wrap: number) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    };
    this.framebuffer = gl.createFramebuffer();

    // The glass optics across a card's bevel (unit 1 for good): r = inward displacement,
    // g = reflectance. The same curves as the liquid glass over the page (design/liquid).
    const table = opticsTable(CARD_GLASS, OPTICS_SIZE);
    this.bend = table.max;
    const texels = new Uint8Array(OPTICS_SIZE * 4);
    for (let i = 0; i < OPTICS_SIZE; i++) {
      texels[i * 4] = Math.round((255 * (table.displacement[i] ?? 0)) / Math.max(1e-6, table.max));
      texels[i * 4 + 1] = Math.round(255 * (table.reflectance[i] ?? 0));
      texels[i * 4 + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    this.optics = texture(gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, OPTICS_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);

    // The light texture (unit 0), sized on the first draw.
    gl.activeTexture(gl.TEXTURE0);
    this.texture = texture(gl.CLAMP_TO_EDGE);
    this.textureSize = { width: 0, height: 0 };
    this.drawnLight = undefined;
    return true;
  }

  get ready(): boolean {
    return this.pane !== null && !this.gl.isContextLost();
  }

  draw(frame: Frame): void {
    const { gl, light, show, pane } = this;
    if (!light || !show || !pane || !this.ready) return;
    const { view, canvas, texture } = frame;

    // Pass 1: the light texture, only when it changed.
    if (texture.width !== this.textureSize.width || texture.height !== this.textureSize.height) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      this.textureSize = { ...texture };
      this.drawnLight = undefined;
    }
    if (!sameLight(this.drawnLight, frame.light)) {
      const l = frame.light;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, texture.width, texture.height);
      gl.useProgram(light.program);
      gl.uniform1f(light.uniform("u_scale"), texture.width / Math.max(1, view.width));
      gl.uniform2f(light.uniform("u_view"), view.width, view.height);
      gl.uniform3fv(light.uniform("u_bg"), l.background);
      gl.uniform3fv(light.uniform("u_a"), l.glowA);
      gl.uniform3fv(light.uniform("u_b"), l.glowB);
      gl.uniform3fv(light.uniform("u_c"), l.glowC);
      gl.uniform2f(light.uniform("u_light"), l.origin[0], l.origin[1]);
      this.drawFull();
      this.drawnLight = l;
    }

    // Pass 2: the texture upscaled, then the glass panes over it.
    if (this.canvas.width !== canvas.width || this.canvas.height !== canvas.height) {
      this.canvas.width = canvas.width;
      this.canvas.height = canvas.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const surface = (p: Program) => {
      gl.useProgram(p.program);
      gl.uniform1i(p.uniform("u_tex"), 0);
      gl.uniform2f(p.uniform("u_view"), view.width, view.height);
    };
    surface(show);
    gl.uniform2f(show.uniform("u_res"), canvas.width, canvas.height);
    this.drawFull();

    if (frame.vertexCount > 0) {
      surface(pane);
      gl.uniform1i(pane.uniform("u_optics"), 1);
      gl.uniform1f(pane.uniform("u_bend"), this.bend);
      gl.uniform3fv(pane.uniform("u_bg"), frame.light.background);
      gl.uniform3fv(pane.uniform("u_a"), frame.light.glowA);
      gl.uniform2f(pane.uniform("u_lightAt"), frame.light.origin[0] * view.width, frame.light.origin[1] * view.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.panes);
      gl.bufferData(gl.ARRAY_BUFFER, frame.panes.subarray(0, frame.vertexCount * PANE_STRIDE), gl.DYNAMIC_DRAW);
      const bytes = PANE_STRIDE * 4;
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 8);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, bytes, 24);
      gl.drawArrays(gl.TRIANGLES, 0, frame.vertexCount);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
    }
  }

  private drawFull(): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Waits for the GPU (one pixel read back). Only for the one-off speed probe. */
  sync(): void {
    const pixel = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
  }

  /** Forces pass 1 on the next draw (the speed probe measures both passes). */
  invalidateLight(): void {
    this.drawnLight = undefined;
  }

  /** Frees GPU objects (the context itself goes with the canvas). */
  dispose(): void {
    const { gl } = this;
    if (!gl.isContextLost()) {
      for (const p of [this.light, this.show, this.pane]) if (p) gl.deleteProgram(p.program);
      gl.deleteBuffer(this.full);
      gl.deleteBuffer(this.panes);
      gl.deleteTexture(this.texture);
      gl.deleteTexture(this.optics);
      gl.deleteFramebuffer(this.framebuffer);
    }
    this.light = null;
    this.show = null;
    this.pane = null;
  }
}
