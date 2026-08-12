/* ============================================================================
   fluid.js — курсорная дымка на первом экране (index.html).

   Настоящая GPU-симуляция жидкости по схеме Stam «stable fluids»: адвекция →
   завихрение → дивергенция → Якоби по давлению → вычитание градиента. Тем же
   способом сделаны оба референса (vividmotion.co и Framer Smooth Liquid Cursor);
   математика и структура проходов — из открытого солвера
   PavelDoGreat/WebGL-Fluid-Simulation (MIT), портировано на чистый WebGL без
   three.js/GSAP и перекрашено под палитру сайта.

   Отличия от оригинала, сделанные осознанно:
   · нет bloom и sunrays — для дыма они дают «неон», а не дымку;
   · краска хранится как ПЛОТНОСТЬ (скаляр), цвет собирается в display-шейдере:
     тёмный дым → оранжевое ядро #FB460D в плотных местах;
   · симуляция стоит, пока герой не на экране, вкладка скрыта или курсор молчит.

   Не запускается вовсе: тач/без мыши, prefers-reduced-motion, узкий экран и
   когда WebGL недоступен (Chrome ≥137 больше не подставляет программный
   рендер — getContext возвращает null, и это нормальный путь: герой просто
   остаётся на своём сплошном фоне).
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.querySelector('canvas.hero-fluid');
  var hero = document.getElementById('hero');
  if (!canvas || !hero) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(hover:hover)').matches) return;
  if (window.innerWidth <= 1024) return;

  var CFG = {
    SIM_RES: 128,          /* сетка скорости/давления */
    DYE_RES: 320,          /* краска мягче сетки экрана — билинейный апскейл сглаживает клуб */
    DENSITY_DISS: 0.6,     /* скорость затухания: t½ = ln2/D ≈ 1.15 c */
    VELOCITY_DISS: 0.9,    /* скорость гаснет быстро — движение спокойное, без вечной болтанки */
    PRESSURE: 0.8,
    PRESSURE_ITER: 22,     /* точнее несжимаемость → ровнее поле, меньше рвани */
    CURL: 2.5,             /* главный регулятор «рваности»: 30 у дефолта даёт языки пламени */
    SPLAT_RADIUS: 0.75,    /* это σ²·2, не радиус: σ = √(R/200) ≈ 0.061 — широкий мягкий клуб */
    SPLAT_FORCE: 1500,     /* слабее толчок — дым плывёт, а не выстреливает */
    SUBSTEPS: 4,           /* дробим путь курсора: непрерывный след вместо цепочки клякс */
    DPR_CAP: 1.5,
    OPACITY: 0.62
  };

  /* ─── контекст ─────────────────────────────────────────────────────────── */
  var params = { alpha: true, depth: false, stencil: false, antialias: false,
                 premultipliedAlpha: false, preserveDrawingBuffer: false,
                 powerPreference: 'high-performance' };
  var gl = canvas.getContext('webgl2', params);
  var isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
  if (!gl) return;                       /* без GPU — герой живёт на сплошном фоне */

  var halfFloat, supportLinear;
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float');
    supportLinear = !!gl.getExtension('OES_texture_float_linear');
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float');
    supportLinear = !!gl.getExtension('OES_texture_half_float_linear');
    if (!halfFloat) return;
  }
  var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;

  function supportRenderTextureFormat(internalFormat, format, type) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteTexture(tex); gl.deleteFramebuffer(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok;
  }
  function getSupportedFormat(internalFormat, format, type) {
    if (supportRenderTextureFormat(internalFormat, format, type)) return { internalFormat: internalFormat, format: format };
    if (!isWebGL2) return null;
    if (internalFormat === gl.R16F)    return getSupportedFormat(gl.RG16F, gl.RG, type);
    if (internalFormat === gl.RG16F)   return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
    return null;
  }
  var fmtRGBA = isWebGL2 ? getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloatTexType)
                         : { internalFormat: gl.RGBA, format: gl.RGBA };
  var fmtRG   = isWebGL2 ? getSupportedFormat(gl.RG16F, gl.RG, halfFloatTexType) : fmtRGBA;
  var fmtR    = isWebGL2 ? getSupportedFormat(gl.R16F, gl.RED, halfFloatTexType) : fmtRGBA;
  if (!fmtRGBA || !fmtRG || !fmtR) return;

  /* ─── шейдеры ──────────────────────────────────────────────────────────── */
  function compile(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }
  var BASE_VERT = [
    'precision highp float;',
    'attribute vec2 aPosition;',
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform vec2 texelSize;',
    'void main(){',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vL = vUv - vec2(texelSize.x, 0.0);',
    '  vR = vUv + vec2(texelSize.x, 0.0);',
    '  vT = vUv + vec2(0.0, texelSize.y);',
    '  vB = vUv - vec2(0.0, texelSize.y);',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');
  var baseVert = compile(gl.VERTEX_SHADER, BASE_VERT);
  if (!baseVert) return;

  function program(fragSource) {
    var frag = compile(gl.FRAGMENT_SHADER, fragSource);
    if (!frag) return null;
    var p = gl.createProgram();
    gl.attachShader(p, baseVert); gl.attachShader(p, frag); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    var uniforms = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; uniforms[name] = gl.getUniformLocation(p, name); }
    return { program: p, uniforms: uniforms };
  }

  var F = 'precision highp float; precision highp sampler2D;\n';

  var copyProg = program(F +
    'varying vec2 vUv; uniform sampler2D uTexture;' +
    'void main(){ gl_FragColor = texture2D(uTexture, vUv); }');

  var clearProg = program(F +
    'varying vec2 vUv; uniform sampler2D uTexture; uniform float value;' +
    'void main(){ gl_FragColor = value * texture2D(uTexture, vUv); }');

  /* краска: круглая клякса с квадратичным спадом, как внешняя сила в референсе */
  var splatProg = program(F +
    'varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio;' +
    'uniform vec3 color; uniform vec2 point; uniform float radius;' +
    'void main(){' +
    '  vec2 p = vUv - point.xy; p.x *= aspectRatio;' +
    '  vec3 splat = exp(-dot(p, p) / radius) * color;' +
    '  vec3 base = texture2D(uTarget, vUv).xyz;' +
    '  gl_FragColor = vec4(base + splat, 1.0);' +
    '}');

  var advectionProg = program(F +
    'varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource;' +
    'uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;' +
    'vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize){' +
    '  vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);' +
    '  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);' +
    '  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);' +
    '  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);' +
    '  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);' +
    '  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);' +
    '}' +
    'void main(){' +
    '  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;' +
    '  vec4 result = bilerp(uSource, coord, dyeTexelSize);' +
    '  float decay = 1.0 + dissipation * dt;' +   /* диссипация = скорость затухания */
    '  gl_FragColor = result / decay;' +
    '}');

  var divergenceProg = program(F +
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;' +
    'uniform sampler2D uVelocity;' +
    'void main(){' +
    '  float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;' +
    '  float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;' +
    '  vec2 C = texture2D(uVelocity, vUv).xy;' +
    '  if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; }' +
    '  if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }' +
    '  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);' +
    '}');

  var curlProg = program(F +
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;' +
    'uniform sampler2D uVelocity;' +
    'void main(){' +
    '  float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y;' +
    '  float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x;' +
    '  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);' +
    '}');

  var vorticityProg = program(F +
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;' +
    'uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;' +
    'void main(){' +
    '  float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x;' +
    '  float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;' +
    '  float C = texture2D(uCurl, vUv).x;' +
    '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));' +
    '  force /= length(force) + 0.0001;' +
    '  force *= curl * C; force.y *= -1.0;' +
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;' +
    '  velocity += force * dt; velocity = min(max(velocity, -1000.0), 1000.0);' +
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);' +
    '}');

  var pressureProg = program(F +
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;' +
    'uniform sampler2D uPressure; uniform sampler2D uDivergence;' +
    'void main(){' +
    '  float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;' +
    '  float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;' +
    '  float divergence = texture2D(uDivergence, vUv).x;' +
    '  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);' +
    '}');

  var gradientProg = program(F +
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;' +
    'uniform sampler2D uPressure; uniform sampler2D uVelocity;' +
    'void main(){' +
    '  float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;' +
    '  float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;' +
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;' +
    '  velocity.xy -= vec2(R - L, T - B);' +
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);' +
    '}');

  /* Дым серый, без цвета: плотность гонит только светлоту — от холодного тёмно-серого
     на краях клуба до почти белого в плотном ядре. Альфа нарастает мягко, чтобы фон
     оставался чёрным, а крупная типографика поверх читалась. */
  var displayProg = program(F +
    'varying vec2 vUv; uniform sampler2D uTexture; uniform float uOpacity;' +
    'void main(){' +
    '  float d = clamp(texture2D(uTexture, vUv).r, 0.0, 1.4);' +
    '  vec3 edge = vec3(0.36, 0.37, 0.40);' +
    '  vec3 core = vec3(0.84, 0.85, 0.88);' +
    '  vec3 col = mix(edge, core, smoothstep(0.18, 0.90, d));' +
    '  float a = smoothstep(0.012, 0.34, d) * uOpacity;' +
    '  gl_FragColor = vec4(col, a);' +
    '}');

  if (!copyProg || !clearProg || !splatProg || !advectionProg || !divergenceProg ||
      !curlProg || !vorticityProg || !pressureProg || !gradientProg || !displayProg) return;

  /* ─── геометрия и FBO ──────────────────────────────────────────────────── */
  var quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  var idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
  function createFBO(w, h, internalFormat, format, type, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }
  function createDoubleFBO(w, h, internalFormat, format, type, filter) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, filter);
    var fbo2 = createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w, height: h, texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
      get read() { return fbo1; }, set read(v) { fbo1 = v; },
      get write() { return fbo2; }, set write(v) { fbo2 = v; },
      swap: function () { var t = fbo1; fbo1 = fbo2; fbo2 = t; }
    };
  }

  var filtering = supportLinear ? gl.LINEAR : gl.NEAREST;
  var dye, velocity, divergenceFBO, curlFBO, pressure;

  function getResolution(res) {
    var ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (ar < 1) ar = 1 / ar;
    var min = Math.round(res), max = Math.round(res * ar);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min } : { width: min, height: max };
  }
  function initFramebuffers() {
    var simRes = getResolution(CFG.SIM_RES), dyeRes = getResolution(CFG.DYE_RES);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, fmtRGBA.internalFormat, fmtRGBA.format, halfFloatTexType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, fmtRG.internalFormat, fmtRG.format, halfFloatTexType, filtering);
    divergenceFBO = createFBO(simRes.width, simRes.height, fmtR.internalFormat, fmtR.format, halfFloatTexType, gl.NEAREST);
    curlFBO = createFBO(simRes.width, simRes.height, fmtR.internalFormat, fmtR.format, halfFloatTexType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, fmtR.internalFormat, fmtR.format, halfFloatTexType, gl.NEAREST);
  }

  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, CFG.DPR_CAP);
    var w = Math.round(hero.clientWidth * dpr), h = Math.round(hero.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      return true;
    }
    return false;
  }
  resizeCanvas();
  initFramebuffers();

  /* ─── симуляция ────────────────────────────────────────────────────────── */
  function use(p) { gl.useProgram(p.program); }

  function step(dt) {
    gl.disable(gl.BLEND);

    use(curlProg);
    gl.uniform2f(curlProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    use(vorticityProg);
    gl.uniform2f(vorticityProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProg.uniforms.uCurl, curlFBO.attach(1));
    gl.uniform1f(vorticityProg.uniforms.curl, CFG.CURL);
    gl.uniform1f(vorticityProg.uniforms.dt, dt);
    blit(velocity.write); velocity.swap();

    use(divergenceProg);
    gl.uniform2f(divergenceProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergenceFBO);

    use(clearProg);
    gl.uniform1i(clearProg.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProg.uniforms.value, CFG.PRESSURE);
    blit(pressure.write); pressure.swap();

    use(pressureProg);
    gl.uniform2f(pressureProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProg.uniforms.uDivergence, divergenceFBO.attach(0));
    for (var i = 0; i < CFG.PRESSURE_ITER; i++) {
      gl.uniform1i(pressureProg.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    use(gradientProg);
    gl.uniform2f(gradientProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientProg.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientProg.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    use(advectionProg);
    gl.uniform2f(advectionProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(advectionProg.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProg.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(advectionProg.uniforms.dt, dt);
    gl.uniform1f(advectionProg.uniforms.dissipation, CFG.VELOCITY_DISS);
    blit(velocity.write); velocity.swap();

    gl.uniform2f(advectionProg.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProg.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProg.uniforms.dissipation, CFG.DENSITY_DISS);
    blit(dye.write); dye.swap();
  }

  function render() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    use(displayProg);
    gl.uniform1i(displayProg.uniforms.uTexture, dye.read.attach(0));
    gl.uniform1f(displayProg.uniforms.uOpacity, CFG.OPACITY);
    blit(null);
  }

  function splat(x, y, dx, dy, amount) {
    /* Клякса ставится из обработчика ввода, а не внутри кадра — значит смешивание
       могло остаться включённым после render(); в FBO пишем без него. */
    gl.disable(gl.BLEND);
    use(splatProg);
    gl.uniform1i(splatProg.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProg.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProg.uniforms.point, x, y);
    gl.uniform3f(splatProg.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProg.uniforms.radius, CFG.SPLAT_RADIUS / 100);
    blit(velocity.write); velocity.swap();

    gl.uniform1i(splatProg.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProg.uniforms.color, amount, amount, amount);
    blit(dye.write); dye.swap();
  }

  /* ─── ввод ───────────────────────────────────────────────────────────────
     Дым рождается РОВНО под физическим курсором, а не под доводчиком.
     Поэтому: (1) клякса ставится прямо в обработчике события, а не откладывается
     до следующего кадра — иначе источник отстаёт на кадр; (2) подписываемся на
     pointerrawupdate, если он есть: события идут с частотой опроса мыши, а не
     раскадрованно; (3) отрезок между двумя событиями заполняется кляксами с
     нарастающим весом — самая плотная приходится на текущую точку курсора, хвост
     лишь дотягивает след. У сайта есть свой курсор .cursor-dot, он намеренно
     догоняет мышь с задержкой — дым с ним не связан и за ним не следует. */
  var pointer = { x: 0, y: 0, inside: false };
  var lastSplat = 0;

  function onPointer(e) {
    if (!running) return;
    var r = hero.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    var y = 1 - (e.clientY - r.top) / r.height;
    if (!pointer.inside) {                 /* вход в кадр не должен бить кляксой */
      pointer.x = x; pointer.y = y; pointer.inside = true; lastSplat = e.timeStamp || performance.now();
      return;
    }
    var now = e.timeStamp || performance.now();
    var elapsed = now - lastSplat;
    if (elapsed < 5) return;               /* потолок ~200 клякс/с для мышей с высоким опросом */
    lastSplat = now;

    var mx = x - pointer.x, my = y - pointer.y;
    var dx = mx * CFG.SPLAT_FORCE, dy = my * CFG.SPLAT_FORCE;
    var speed = Math.min(Math.sqrt(dx * dx + dy * dy) / 900, 1);
    /* нормируем по времени: при 240 Гц не должно выходить вчетверо больше краски */
    var rate = Math.min(elapsed / 16.67, 1.5);
    var total = (0.042 + speed * 0.17) * rate;

    var n = CFG.SUBSTEPS, wSum = n * (n + 1) / 2;
    for (var i = 1; i <= n; i++) {
      var k = i / n;                        /* k = 1 — текущая точка курсора */
      splat(pointer.x + mx * k, pointer.y + my * k, dx / n, dy / n, total * (i / wSum));
    }
    pointer.x = x; pointer.y = y;
  }

  if ('onpointerrawupdate' in hero) hero.addEventListener('pointerrawupdate', onPointer, { passive: true });
  else hero.addEventListener('pointermove', onPointer, { passive: true });
  hero.addEventListener('pointerleave', function () { pointer.inside = false; }, { passive: true });

  /* ─── цикл ─────────────────────────────────────────────────────────────── */
  var visible = true, running = false, rafId = null, lastTime = performance.now();
  var io = new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    if (visible) start(); else stop();
  }, { threshold: 0 });
  io.observe(hero);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (visible) start();
  });

  function frame(now) {
    rafId = null;
    var dt = Math.min((now - lastTime) / 1000, 0.016666);
    lastTime = now;
    if (resizeCanvas()) initFramebuffers();
    step(dt);
    render();
    if (running) rafId = requestAnimationFrame(frame);
  }
  function start() {
    if (running || document.hidden) return;
    running = true; lastTime = performance.now();
    if (rafId === null) rafId = requestAnimationFrame(frame);
    canvas.classList.add('is-ready');
  }
  function stop() {
    running = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); }, false);
  window.addEventListener('resize', function () { if (resizeCanvas()) initFramebuffers(); }, { passive: true });
  start();
})();
