/**
 * raylib-wasi Standalone Host Runtime Bridge
 * Zero-dependency vanilla ES module for WebGL, input sync & WASI execution
 * https://github.com/breeze833/raylib-wasi
 */

// gl-context.js - WebGL ES 2.0 Host State Machine and Handle Table

function createGLImports(gl, getMemory) {
  const buffers = new Map();
  const textures = new Map();
  const shaders = new Map();
  const programs = new Map();
  const framebuffers = new Map();
  const renderbuffers = new Map();
  const uniformLocations = new Map();

  let nextBufferId = 1;
  let nextTextureId = 1;
  let nextShaderId = 1;
  let nextProgramId = 1;
  let nextFramebufferId = 1;
  let nextRenderbufferId = 1;
  let nextUniformLocId = 1;

  const utf8Decoder = new TextDecoder('utf-8');
  const utf8Encoder = new TextEncoder();

  function getString(ptr, len) {
    if (ptr === 0) return '';
    const mem = getMemory();
    if (len >= 0) {
      return utf8Decoder.decode(new Uint8Array(mem.buffer, ptr, len));
    }
    // Null-terminated string
    const u8 = new Uint8Array(mem.buffer, ptr);
    let end = 0;
    while (u8[end] !== 0) end++;
    return utf8Decoder.decode(new Uint8Array(mem.buffer, ptr, end));
  }

  function writeString(str, bufPtr, maxLen) {
    if (bufPtr === 0 || maxLen <= 0) return 0;
    const mem = getMemory();
    const encoded = utf8Encoder.encode(str);
    const writeLen = Math.min(encoded.length, maxLen - 1);
    const dest = new Uint8Array(mem.buffer, bufPtr, maxLen);
    dest.set(encoded.subarray(0, writeLen));
    dest[writeLen] = 0;
    return writeLen;
  }

  function getBytesPerPixel(format, type) {
    // 0x1406 = FLOAT
    // 0x1401 = UNSIGNED_BYTE
    // 0x8363 = UNSIGNED_SHORT_5_6_5
    // 0x8033 = UNSIGNED_SHORT_4_4_4_4
    // 0x8034 = UNSIGNED_SHORT_5_5_5_1
    let channels = 4;
    switch (format) {
      case 0x1906: channels = 1; break; // ALPHA
      case 0x1909: channels = 1; break; // LUMINANCE
      case 0x190A: channels = 2; break; // LUMINANCE_ALPHA
      case 0x1907: channels = 3; break; // RGB
      case 0x1908: channels = 4; break; // RGBA
      case 0x1902: channels = 1; break; // DEPTH_COMPONENT
    }

    if (type === 0x1406) return channels * 4; // FLOAT
    if (type === 0x8363 || type === 0x8033 || type === 0x8034 || type === 0x1403) return 2; // UNSIGNED_SHORT
    return channels; // UNSIGNED_BYTE
  }

  // Extensions query
  let anisoExt = null;
  if (gl && gl.getExtension) {
    anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
               gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
               gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    gl.getExtension('OES_texture_float');
    gl.getExtension('OES_texture_half_float');
    gl.getExtension('OES_element_index_uint');
    gl.getExtension('OES_standard_derivatives');
  }

  return {
    // Scalar & State
    glViewport: (x, y, w, h) => gl.viewport(x, y, w, h),
    glClear: (mask) => gl.clear(mask),
    glClearColor: (r, g, b, a) => gl.clearColor(r, g, b, a),
    glClearDepthf: (d) => gl.clearDepth(d),
    glClearStencil: (s) => gl.clearStencil(s),
    glColorMask: (r, g, b, a) => gl.colorMask(!!r, !!g, !!b, !!a),
    glDepthMask: (flag) => gl.depthMask(!!flag),
    glDepthFunc: (func) => gl.depthFunc(func),
    glDepthRangef: (n, f) => gl.depthRange(n, f),
    glCullFace: (mode) => gl.cullFace(mode),
    glFrontFace: (mode) => gl.frontFace(mode),
    glEnable: (cap) => gl.enable(cap),
    glDisable: (cap) => gl.disable(cap),
    glBlendFunc: (s, d) => gl.blendFunc(s, d),
    glBlendFuncSeparate: (sRGB, dRGB, sA, dA) => gl.blendFuncSeparate(sRGB, dRGB, sA, dA),
    glBlendEquation: (mode) => gl.blendEquation(mode),
    glBlendEquationSeparate: (modeRGB, modeA) => gl.blendEquationSeparate(modeRGB, modeA),
    glBlendColor: (r, g, b, a) => gl.blendColor(r, g, b, a),
    glLineWidth: (w) => gl.lineWidth(w),
    glPolygonOffset: (factor, units) => gl.polygonOffset(factor, units),
    glScissor: (x, y, w, h) => gl.scissor(x, y, w, h),
    glSampleCoverage: (value, invert) => gl.sampleCoverage(value, !!invert),
    glHint: (target, mode) => gl.hint(target, mode),
    glPixelStorei: (pname, param) => gl.pixelStorei(pname, param),
    glFlush: () => gl.flush(),
    glFinish: () => gl.finish(),
    glGetError: () => gl.getError(),

    // Buffer management
    glGenBuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = nextBufferId++;
        buffers.set(id, gl.createBuffer());
        u32[i] = id;
      }
    },
    glDeleteBuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = u32[i];
        const buf = buffers.get(id);
        if (buf) {
          gl.deleteBuffer(buf);
          buffers.delete(id);
        }
      }
    },
    glBindBuffer: (target, id) => {
      gl.bindBuffer(target, id ? buffers.get(id) || null : null);
    },
    glBufferData: (target, size, dataPtr, usage) => {
      if (dataPtr === 0) {
        gl.bufferData(target, size, usage);
      } else {
        const mem = getMemory();
        const data = new Uint8Array(mem.buffer, dataPtr, size);
        gl.bufferData(target, data, usage);
      }
    },
    glBufferSubData: (target, offset, size, dataPtr) => {
      const mem = getMemory();
      const data = new Uint8Array(mem.buffer, dataPtr, size);
      gl.bufferSubData(target, offset, data);
    },

    // Texture management
    glGenTextures: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = nextTextureId++;
        textures.set(id, gl.createTexture());
        u32[i] = id;
      }
    },
    glDeleteTextures: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = u32[i];
        const tex = textures.get(id);
        if (tex) {
          gl.deleteTexture(tex);
          textures.delete(id);
        }
      }
    },
    glBindTexture: (target, id) => {
      gl.bindTexture(target, id ? textures.get(id) || null : null);
    },
    glActiveTexture: (texture) => gl.activeTexture(texture),
    glTexParameteri: (target, pname, param) => gl.texParameteri(target, pname, param),
    glTexParameterf: (target, pname, param) => gl.texParameterf(target, pname, param),
    glTexParameteriv: (target, pname, ptr) => {
      const mem = getMemory();
      gl.texParameteri(target, pname, new Int32Array(mem.buffer, ptr, 1)[0]);
    },
    glTexParameterfv: (target, pname, ptr) => {
      const mem = getMemory();
      gl.texParameterf(target, pname, new Float32Array(mem.buffer, ptr, 1)[0]);
    },
    glGenerateMipmap: (target) => gl.generateMipmap(target),
    glTexImage2D: (target, level, internalformat, width, height, border, format, type, pixelsPtr) => {
      if (pixelsPtr === 0) {
        gl.texImage2D(target, level, internalformat, width, height, border, format, type, null);
      } else {
        const mem = getMemory();
        const bpp = getBytesPerPixel(format, type);
        const byteLen = width * height * bpp;
        const data = new Uint8Array(mem.buffer, pixelsPtr, byteLen);
        gl.texImage2D(target, level, internalformat, width, height, border, format, type, data);
      }
    },
    glTexSubImage2D: (target, level, xoffset, yoffset, width, height, format, type, pixelsPtr) => {
      const mem = getMemory();
      const bpp = getBytesPerPixel(format, type);
      const byteLen = width * height * bpp;
      const data = new Uint8Array(mem.buffer, pixelsPtr, byteLen);
      gl.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, data);
    },
    glCompressedTexImage2D: (target, level, internalformat, width, height, border, imageSize, dataPtr) => {
      const mem = getMemory();
      const data = new Uint8Array(mem.buffer, dataPtr, imageSize);
      gl.compressedTexImage2D(target, level, internalformat, width, height, border, data);
    },
    glCompressedTexSubImage2D: (target, level, xoffset, yoffset, width, height, format, imageSize, dataPtr) => {
      const mem = getMemory();
      const data = new Uint8Array(mem.buffer, dataPtr, imageSize);
      gl.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, data);
    },
    glCopyTexImage2D: (target, level, internalformat, x, y, width, height, border) => {
      gl.copyTexImage2D(target, level, internalformat, x, y, width, height, border);
    },
    glCopyTexSubImage2D: (target, level, xoffset, yoffset, x, y, width, height) => {
      gl.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    },

    // Shaders & Programs
    glCreateShader: (type) => {
      const id = nextShaderId++;
      shaders.set(id, gl.createShader(type));
      return id;
    },
    glDeleteShader: (id) => {
      const s = shaders.get(id);
      if (s) {
        gl.deleteShader(s);
        shaders.delete(id);
      }
    },
    glCompileShader: (id) => {
      const s = shaders.get(id);
      if (s) gl.compileShader(s);
    },
    glGetShaderiv: (id, pname, paramsPtr) => {
      const s = shaders.get(id);
      const mem = getMemory();
      const out = new Int32Array(mem.buffer, paramsPtr, 1);
      if (!s) { out[0] = 0; return; }
      if (pname === 0x8B84) { // GL_INFO_LOG_LENGTH
        const log = gl.getShaderInfoLog(s) || '';
        out[0] = log.length > 0 ? log.length + 1 : 0;
      } else {
        const val = gl.getShaderParameter(s, pname);
        out[0] = typeof val === 'boolean' ? (val ? 1 : 0) : (val || 0);
      }
    },
    glCreateProgram: () => {
      const id = nextProgramId++;
      programs.set(id, gl.createProgram());
      return id;
    },
    glDeleteProgram: (id) => {
      const p = programs.get(id);
      if (p) {
        gl.deleteProgram(p);
        programs.delete(id);
      }
    },
    glAttachShader: (progId, shaderId) => {
      const p = programs.get(progId);
      const s = shaders.get(shaderId);
      if (p && s) gl.attachShader(p, s);
    },
    glDetachShader: (progId, shaderId) => {
      const p = programs.get(progId);
      const s = shaders.get(shaderId);
      if (p && s) gl.detachShader(p, s);
    },
    glLinkProgram: (progId) => {
      const p = programs.get(progId);
      if (p) gl.linkProgram(p);
    },
    glUseProgram: (progId) => {
      gl.useProgram(progId ? programs.get(progId) || null : null);
    },
    glValidateProgram: (progId) => {
      const p = programs.get(progId);
      if (p) gl.validateProgram(p);
    },
    glGetProgramiv: (progId, pname, paramsPtr) => {
      const p = programs.get(progId);
      const mem = getMemory();
      const out = new Int32Array(mem.buffer, paramsPtr, 1);
      if (!p) { out[0] = 0; return; }
      if (pname === 0x8B84) { // GL_INFO_LOG_LENGTH
        const log = gl.getProgramInfoLog(p) || '';
        out[0] = log.length > 0 ? log.length + 1 : 0;
      } else {
        const val = gl.getProgramParameter(p, pname);
        out[0] = typeof val === 'boolean' ? (val ? 1 : 0) : (val || 0);
      }
    },

    // Vertex Attributes
    glVertexAttribPointer: (index, size, type, normalized, stride, offset) => {
      gl.vertexAttribPointer(index, size, type, !!normalized, stride, offset);
    },
    glEnableVertexAttribArray: (index) => gl.enableVertexAttribArray(index),
    glDisableVertexAttribArray: (index) => gl.disableVertexAttribArray(index),
    glVertexAttrib1f: (index, x) => gl.vertexAttrib1f(index, x),
    glVertexAttrib2f: (index, x, y) => gl.vertexAttrib2f(index, x, y),
    glVertexAttrib3f: (index, x, y, z) => gl.vertexAttrib3f(index, x, y, z),
    glVertexAttrib4f: (index, x, y, z, w) => gl.vertexAttrib4f(index, x, y, z, w),
    glVertexAttrib1fv: (index, ptr) => {
      const mem = getMemory();
      gl.vertexAttrib1fv(index, new Float32Array(mem.buffer, ptr, 1));
    },
    glVertexAttrib2fv: (index, ptr) => {
      const mem = getMemory();
      gl.vertexAttrib2fv(index, new Float32Array(mem.buffer, ptr, 2));
    },
    glVertexAttrib3fv: (index, ptr) => {
      const mem = getMemory();
      gl.vertexAttrib3fv(index, new Float32Array(mem.buffer, ptr, 3));
    },
    glVertexAttrib4fv: (index, ptr) => {
      const mem = getMemory();
      gl.vertexAttrib4fv(index, new Float32Array(mem.buffer, ptr, 4));
    },

    // Uniforms
    glUniform1i: (locId, x) => {
      const loc = uniformLocations.get(locId);
      if (loc) gl.uniform1i(loc, x);
    },
    glUniform1f: (locId, x) => {
      const loc = uniformLocations.get(locId);
      if (loc) gl.uniform1f(loc, x);
    },
    glUniform2f: (locId, x, y) => {
      const loc = uniformLocations.get(locId);
      if (loc) gl.uniform2f(loc, x, y);
    },
    glUniform3f: (locId, x, y, z) => {
      const loc = uniformLocations.get(locId);
      if (loc) gl.uniform3f(loc, x, y, z);
    },
    glUniform4f: (locId, x, y, z, w) => {
      const loc = uniformLocations.get(locId);
      if (loc) gl.uniform4f(loc, x, y, z, w);
    },
    glUniform1iv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform1iv(loc, new Int32Array(mem.buffer, ptr, count));
      }
    },
    glUniform2iv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform2iv(loc, new Int32Array(mem.buffer, ptr, count * 2));
      }
    },
    glUniform3iv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform3iv(loc, new Int32Array(mem.buffer, ptr, count * 3));
      }
    },
    glUniform4iv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform4iv(loc, new Int32Array(mem.buffer, ptr, count * 4));
      }
    },
    glUniform1fv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform1fv(loc, new Float32Array(mem.buffer, ptr, count));
      }
    },
    glUniform2fv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform2fv(loc, new Float32Array(mem.buffer, ptr, count * 2));
      }
    },
    glUniform3fv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform3fv(loc, new Float32Array(mem.buffer, ptr, count * 3));
      }
    },
    glUniform4fv: (locId, count, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniform4fv(loc, new Float32Array(mem.buffer, ptr, count * 4));
      }
    },
    glUniformMatrix2fv: (locId, count, transpose, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniformMatrix2fv(loc, !!transpose, new Float32Array(mem.buffer, ptr, count * 4));
      }
    },
    glUniformMatrix3fv: (locId, count, transpose, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniformMatrix3fv(loc, !!transpose, new Float32Array(mem.buffer, ptr, count * 9));
      }
    },
    glUniformMatrix4fv: (locId, count, transpose, ptr) => {
      const loc = uniformLocations.get(locId);
      if (loc) {
        const mem = getMemory();
        gl.uniformMatrix4fv(loc, !!transpose, new Float32Array(mem.buffer, ptr, count * 16));
      }
    },

    // Drawing
    glDrawArrays: (mode, first, count) => gl.drawArrays(mode, first, count),
    glDrawElements: (mode, count, type, indicesOffset) => gl.drawElements(mode, count, type, indicesOffset),

    // Framebuffer & Renderbuffer
    glGenFramebuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = nextFramebufferId++;
        framebuffers.set(id, gl.createFramebuffer());
        u32[i] = id;
      }
    },
    glDeleteFramebuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = u32[i];
        const fb = framebuffers.get(id);
        if (fb) {
          gl.deleteFramebuffer(fb);
          framebuffers.delete(id);
        }
      }
    },
    glBindFramebuffer: (target, id) => {
      gl.bindFramebuffer(target, id ? framebuffers.get(id) || null : null);
    },
    glCheckFramebufferStatus: (target) => gl.checkFramebufferStatus(target),
    glFramebufferTexture2D: (target, attachment, textarget, texId, level) => {
      gl.framebufferTexture2D(target, attachment, textarget, textures.get(texId) || null, level);
    },
    glFramebufferRenderbuffer: (target, attachment, rbTarget, rbId) => {
      gl.framebufferRenderbuffer(target, attachment, rbTarget, renderbuffers.get(rbId) || null);
    },
    glGenRenderbuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = nextRenderbufferId++;
        renderbuffers.set(id, gl.createRenderbuffer());
        u32[i] = id;
      }
    },
    glDeleteRenderbuffers: (n, ptr) => {
      const mem = getMemory();
      const u32 = new Uint32Array(mem.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        const id = u32[i];
        const rb = renderbuffers.get(id);
        if (rb) {
          gl.deleteRenderbuffer(rb);
          renderbuffers.delete(id);
        }
      }
    },
    glBindRenderbuffer: (target, id) => {
      gl.bindRenderbuffer(target, id ? renderbuffers.get(id) || null : null);
    },
    glRenderbufferStorage: (target, internalformat, width, height) => {
      gl.renderbufferStorage(target, internalformat, width, height);
    },
    glGetFramebufferAttachmentParameteriv: (target, attachment, pname, paramsPtr) => {
      const val = gl.getFramebufferAttachmentParameter(target, attachment, pname);
      const mem = getMemory();
      new Int32Array(mem.buffer, paramsPtr, 1)[0] = typeof val === 'number' ? val : 0;
    },
    glGetRenderbufferParameteriv: (target, pname, paramsPtr) => {
      const val = gl.getRenderbufferParameter(target, pname);
      const mem = getMemory();
      new Int32Array(mem.buffer, paramsPtr, 1)[0] = typeof val === 'number' ? val : 0;
    },

    // Queries
    glGetIntegerv: (pname, paramsPtr) => {
      const mem = getMemory();
      const out = new Int32Array(mem.buffer, paramsPtr, 4);
      switch (pname) {
        case 0x0D33: // GL_MAX_TEXTURE_SIZE
          out[0] = gl.getParameter(pname) || 2048;
          break;
        case 0x8872: // GL_MAX_TEXTURE_IMAGE_UNITS
          out[0] = gl.getParameter(pname) || 8;
          break;
        case 0x8869: // GL_MAX_VERTEX_ATTRIBS
          out[0] = gl.getParameter(pname) || 8;
          break;
        case 0x851C: // GL_MAX_CUBE_MAP_TEXTURE_SIZE
          out[0] = gl.getParameter(pname) || 2048;
          break;
        case 0x0BA2: { // GL_VIEWPORT
          const vp = gl.getParameter(pname);
          if (vp) {
            out[0] = vp[0]; out[1] = vp[1]; out[2] = vp[2]; out[3] = vp[3];
          }
          break;
        }
        case 0x86A2: // GL_NUM_COMPRESSED_TEXTURE_FORMATS
          out[0] = 0;
          break;
        default: {
          const val = gl.getParameter(pname);
          out[0] = typeof val === 'number' ? val : 0;
          break;
        }
      }
    },
    glGetFloatv: (pname, paramsPtr) => {
      const mem = getMemory();
      const out = new Float32Array(mem.buffer, paramsPtr, 1);
      if (pname === 0x84FF) { // GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT
        if (anisoExt) {
          out[0] = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1.0;
        } else {
          out[0] = 1.0;
        }
      } else {
        const val = gl.getParameter(pname);
        out[0] = typeof val === 'number' ? val : 0.0;
      }
    },
    glGetBooleanv: (pname, paramsPtr) => {
      const mem = getMemory();
      const val = gl.getParameter(pname);
      new Uint8Array(mem.buffer, paramsPtr, 1)[0] = val ? 1 : 0;
    },
    glGetBufferParameteriv: (target, pname, paramsPtr) => {
      const val = gl.getBufferParameter(target, pname);
      const mem = getMemory();
      new Int32Array(mem.buffer, paramsPtr, 1)[0] = typeof val === 'number' ? val : 0;
    },
    glReadPixels: (x, y, w, h, format, type, pixelsPtr) => {
      const mem = getMemory();
      const bpp = getBytesPerPixel(format, type);
      const data = new Uint8Array(mem.buffer, pixelsPtr, w * h * bpp);
      gl.readPixels(x, y, w, h, format, type, data);
    },

    // C Wrappers raw host imports
    gl_host_get_string: (name, bufPtr, maxLen) => {
      let str = '';
      switch (name) {
        case 0x1F00: str = 'WebKit / WebGL'; break; // GL_VENDOR
        case 0x1F01: str = 'WebGL Canvas Renderer'; break; // GL_RENDERER
        case 0x1F02: str = 'OpenGL ES 2.0 (WebGL 1.0)'; break; // GL_VERSION
        case 0x8B8C: str = 'WebGL GLSL ES 1.0'; break; // GL_SHADING_LANGUAGE_VERSION
        case 0x1F03: // GL_EXTENSIONS
          str = 'GL_OES_texture_float GL_OES_texture_half_float GL_OES_element_index_uint GL_OES_standard_derivatives';
          if (anisoExt) str += ' GL_EXT_texture_filter_anisotropic';
          break;
      }
      return writeString(str, bufPtr, maxLen);
    },
    gl_host_shader_source: (shaderId, srcPtr, len) => {
      const s = shaders.get(shaderId);
      if (!s) return;
      let source = getString(srcPtr, len);
      gl.shaderSource(s, source);
    },
    gl_host_get_shader_info_log: (shaderId, maxLen, lenPtr, bufPtr) => {
      const s = shaders.get(shaderId);
      const log = s ? (gl.getShaderInfoLog(s) || '') : '';
      const written = writeString(log, bufPtr, maxLen);
      if (lenPtr !== 0) {
        const mem = getMemory();
        new Int32Array(mem.buffer, lenPtr, 1)[0] = written;
      }
    },
    gl_host_get_program_info_log: (progId, maxLen, lenPtr, bufPtr) => {
      const p = programs.get(progId);
      const log = p ? (gl.getProgramInfoLog(p) || '') : '';
      const written = writeString(log, bufPtr, maxLen);
      if (lenPtr !== 0) {
        const mem = getMemory();
        new Int32Array(mem.buffer, lenPtr, 1)[0] = written;
      }
    },
    gl_host_get_uniform_location: (progId, namePtr, nameLen) => {
      const p = programs.get(progId);
      if (!p) return -1;
      const name = getString(namePtr, nameLen);
      const loc = gl.getUniformLocation(p, name);
      if (!loc) return -1;
      const id = nextUniformLocId++;
      uniformLocations.set(id, loc);
      return id;
    },
    gl_host_get_attrib_location: (progId, namePtr, nameLen) => {
      const p = programs.get(progId);
      if (!p) return -1;
      const name = getString(namePtr, nameLen);
      return gl.getAttribLocation ? gl.getAttribLocation(p, name) : 0;
    },
    gl_host_bind_attrib_location: (progId, index, namePtr, nameLen) => {
      const p = programs.get(progId);
      if (!p) return;
      const name = getString(namePtr, nameLen);
      if (gl.bindAttribLocation) gl.bindAttribLocation(p, index, name);
    }
  };
}


// input.js - Keyboard and Mouse Input Coordinator with SharedArrayBuffer support

const DOM_KEY_MAP = {
  KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69, KeyF: 70, KeyG: 71,
  KeyH: 72, KeyI: 73, KeyJ: 74, KeyK: 75, KeyL: 76, KeyM: 77, KeyN: 78,
  KeyO: 79, KeyP: 80, KeyQ: 81, KeyR: 82, KeyS: 83, KeyT: 84, KeyU: 85,
  KeyV: 86, KeyW: 87, KeyX: 88, KeyY: 89, KeyZ: 90,

  Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52,
  Digit5: 53, Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,

  Space: 32, Escape: 256, Enter: 257, Tab: 258, Backspace: 259,
  Insert: 260, Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
  PageUp: 266, PageDown: 267, Home: 268, End: 269,
  CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,

  F1: 290, F2: 291, F3: 292, F4: 293, F5: 294, F6: 295,
  F7: 296, F8: 297, F9: 298, F10: 299, F11: 300, F12: 301,

  ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343,
  ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347,
  ContextMenu: 348,

  Semicolon: 59, Equal: 61, Comma: 44, Minus: 45, Period: 46, Slash: 47,
  Backquote: 96, BracketLeft: 91, Backslash: 92, BracketRight: 93, Quote: 39,

  Numpad0: 320, Numpad1: 321, Numpad2: 322, Numpad3: 323, Numpad4: 324,
  Numpad5: 325, Numpad6: 326, Numpad7: 327, Numpad8: 328, Numpad9: 329,
  NumpadDecimal: 330, NumpadDivide: 331, NumpadMultiply: 332,
  NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335, NumpadEqual: 336
};

class InputCoordinator {
  constructor(options = {}) {
    this.sharedBuffer = options.sharedBuffer || null;
    this.canvas = options.canvas || null;

    this.windowWidth = options.width || 800;
    this.windowHeight = options.height || 450;
    this.renderWidth = options.width || 800;
    this.renderHeight = options.height || 450;
    this.dpiScale = options.dpiScale || 1.0;
    this.shouldClose = false;

    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseWheelX = 0;
    this.mouseWheelY = 0;
    this.mouseButtons = 0;

    this.keysDown = new Uint32Array(16); // 512 bits
    this.keyPressedQueue = [];
    this.charPressedQueue = [];

    if (this.sharedBuffer) {
      this.sharedView = new DataView(this.sharedBuffer);
      this.sharedU8 = new Uint8Array(this.sharedBuffer);
      this.syncWord = new Int32Array(this.sharedBuffer, 372, 1);
    }

    if (this.canvas && typeof this.canvas.addEventListener === 'function') {
      this.attachListeners(this.canvas);
    }
  }

  attachListeners(canvas) {
    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || 1);
      const scaleY = canvas.height / (rect.height || 1);
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    canvas.addEventListener('mousemove', (e) => {
      const pos = getCoords(e);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this.updateSharedState();
    });

    canvas.addEventListener('mousedown', (e) => {
      const bit = e.button === 0 ? 1 : (e.button === 2 ? 2 : (e.button === 1 ? 4 : 0));
      this.mouseButtons |= bit;
      const pos = getCoords(e);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this.updateSharedState();
    });

    canvas.addEventListener('mouseup', (e) => {
      const bit = e.button === 0 ? 1 : (e.button === 2 ? 2 : (e.button === 1 ? 4 : 0));
      this.mouseButtons &= ~bit;
      this.updateSharedState();
    });

    canvas.addEventListener('wheel', (e) => {
      this.mouseWheelX += (e.deltaX > 0 ? 1 : (e.deltaX < 0 ? -1 : 0));
      this.mouseWheelY += (e.deltaY > 0 ? -1 : (e.deltaY < 0 ? 1 : 0));
      this.updateSharedState();
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Canvas keyboard listeners (only captures when canvas is focused)
    const target = canvas;
    target.addEventListener('keydown', (e) => {
      const rayKey = DOM_KEY_MAP[e.code] || e.keyCode;
      if (rayKey >= 0 && rayKey < 512) {
        const word = Math.floor(rayKey / 32);
        const bit = rayKey % 32;
        this.keysDown[word] |= (1 << bit);
        if (this.keyPressedQueue.length < 32) {
          this.keyPressedQueue.push(rayKey);
        }
      }
      if (e.key && e.key.length === 1) {
        const cp = e.key.codePointAt(0);
        if (cp && this.charPressedQueue.length < 32) {
          this.charPressedQueue.push(cp);
        }
      }
      if (e.code === 'Escape') {
        this.shouldClose = true;
      }
      this.updateSharedState();
    });

    target.addEventListener('keyup', (e) => {
      const rayKey = DOM_KEY_MAP[e.code] || e.keyCode;
      if (rayKey >= 0 && rayKey < 512) {
        const word = Math.floor(rayKey / 32);
        const bit = rayKey % 32;
        this.keysDown[word] &= ~(1 << bit);
      }
      this.updateSharedState();
    });
  }

  updateSharedState() {
    if (!this.sharedView) return;
    const v = this.sharedView;
    v.setInt32(0, this.windowWidth, true);
    v.setInt32(4, this.windowHeight, true);
    v.setInt32(8, this.renderWidth, true);
    v.setInt32(12, this.renderHeight, true);
    v.setFloat32(16, this.dpiScale, true);
    v.setInt32(20, this.shouldClose ? 1 : 0, true);

    v.setFloat32(24, this.mouseX, true);
    v.setFloat32(28, this.mouseY, true);
    v.setFloat32(32, this.mouseWheelX, true);
    v.setFloat32(36, this.mouseWheelY, true);
    v.setUint32(40, this.mouseButtons, true);

    for (let i = 0; i < 16; i++) {
      v.setUint32(44 + i * 4, this.keysDown[i], true);
    }

    const kCount = Math.min(this.keyPressedQueue.length, 32);
    v.setInt32(108, kCount, true);
    for (let i = 0; i < kCount; i++) {
      v.setInt32(112 + i * 4, this.keyPressedQueue[i], true);
    }

    const cCount = Math.min(this.charPressedQueue.length, 32);
    v.setInt32(240, cCount, true);
    for (let i = 0; i < cCount; i++) {
      v.setInt32(244 + i * 4, this.charPressedQueue[i], true);
    }
  }

  // Called synchronously by rcore_wasi.c on each frame
  pollToWasm(destPtr, mem) {
    if (this.sharedBuffer) {
      // Direct copy from SharedArrayBuffer to Wasm linear memory
      const destU8 = new Uint8Array(mem.buffer, destPtr, 372);
      destU8.set(this.sharedU8.subarray(0, 372));
      // Reset wheel deltas and queues in shared buffer
      this.sharedView.setFloat32(32, 0, true);
      this.sharedView.setFloat32(36, 0, true);
      this.sharedView.setInt32(108, 0, true);
      this.sharedView.setInt32(240, 0, true);
      return;
    }

    // Single-thread / local memory fallback
    const view = new DataView(mem.buffer, destPtr, 372);
    view.setInt32(0, this.windowWidth, true);
    view.setInt32(4, this.windowHeight, true);
    view.setInt32(8, this.renderWidth, true);
    view.setInt32(12, this.renderHeight, true);
    view.setFloat32(16, this.dpiScale, true);
    view.setInt32(20, this.shouldClose ? 1 : 0, true);

    view.setFloat32(24, this.mouseX, true);
    view.setFloat32(28, this.mouseY, true);
    view.setFloat32(32, this.mouseWheelX, true);
    view.setFloat32(36, this.mouseWheelY, true);
    view.setUint32(40, this.mouseButtons, true);

    for (let i = 0; i < 16; i++) {
      view.setUint32(44 + i * 4, this.keysDown[i], true);
    }

    const kCount = Math.min(this.keyPressedQueue.length, 32);
    view.setInt32(108, kCount, true);
    for (let i = 0; i < kCount; i++) {
      view.setInt32(112 + i * 4, this.keyPressedQueue[i], true);
    }

    const cCount = Math.min(this.charPressedQueue.length, 32);
    view.setInt32(240, cCount, true);
    for (let i = 0; i < cCount; i++) {
      view.setInt32(244 + i * 4, this.charPressedQueue[i], true);
    }

    // Reset frame-transient values
    this.mouseWheelX = 0;
    this.mouseWheelY = 0;
    this.keyPressedQueue.length = 0;
    this.charPressedQueue.length = 0;
  }
}


// wasi.js - Standard WASI Snapshot Preview 1 implementation for browser & node

function createWasiImports(getMemory, options = {}) {
  const utf8Decoder = new TextDecoder('utf-8');
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const printStdout = options.print || ((text) => console.log(text));
  const printStderr = options.printErr || ((text) => console.error(text));

  return {
    proc_exit: (code) => {
      if (options.onExit) options.onExit(code);
      const err = new Error(`WASI program exited with code ${code}`);
      err.exitCode = code;
      throw err;
    },

    environ_sizes_get: (countPtr, bufSizePtr) => {
      const mem = getMemory();
      new Uint32Array(mem.buffer, countPtr, 1)[0] = 0;
      new Uint32Array(mem.buffer, bufSizePtr, 1)[0] = 0;
      return 0; // Success
    },

    environ_get: (environ, environBuf) => 0,

    args_sizes_get: (argcPtr, argvBufSizePtr) => {
      const mem = getMemory();
      new Uint32Array(mem.buffer, argcPtr, 1)[0] = 0;
      new Uint32Array(mem.buffer, argvBufSizePtr, 1)[0] = 0;
      return 0;
    },

    args_get: (argv, argvBuf) => 0,

    clock_time_get: (id, precision, timePtr) => {
      const mem = getMemory();
      const nowMs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const nowNs = BigInt(Math.floor(nowMs * 1e6));
      new BigUint64Array(mem.buffer, timePtr, 1)[0] = nowNs;
      return 0;
    },

    clock_res_get: (id, resPtr) => {
      const mem = getMemory();
      new BigUint64Array(mem.buffer, resPtr, 1)[0] = 1000n; // 1 microsecond resolution
      return 0;
    },

    fd_write: (fd, iovs, iovs_len, nwrittenPtr) => {
      const mem = getMemory();
      const view = new DataView(mem.buffer);
      let totalWritten = 0;

      for (let i = 0; i < iovs_len; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        const chunk = new Uint8Array(mem.buffer, ptr, len);
        const str = utf8Decoder.decode(chunk);

        if (fd === 1) { // stdout
          stdoutBuffer += str;
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop();
          for (const line of lines) printStdout(line);
        } else if (fd === 2) { // stderr
          stderrBuffer += str;
          const lines = stderrBuffer.split('\n');
          stderrBuffer = lines.pop();
          for (const line of lines) printStderr(line);
        }
        totalWritten += len;
      }

      if (nwrittenPtr !== 0) {
        view.setUint32(nwrittenPtr, totalWritten, true);
      }
      return 0;
    },

    fd_read: (fd, iovs, iovs_len, nreadPtr) => {
      if (nreadPtr !== 0) {
        const mem = getMemory();
        new Uint32Array(mem.buffer, nreadPtr, 1)[0] = 0;
      }
      return 0;
    },

    fd_seek: (fd, offset, whence, newOffsetPtr) => {
      if (newOffsetPtr !== 0) {
        const mem = getMemory();
        new BigUint64Array(mem.buffer, newOffsetPtr, 1)[0] = 0n;
      }
      return 0;
    },

    fd_close: (fd) => 0,
    fd_sync: (fd) => 0,

    fd_fdstat_get: (fd, statPtr) => {
      const mem = getMemory();
      const view = new DataView(mem.buffer, statPtr, 24);
      // fs_filetype: 2 = character device for stdio
      view.setUint8(0, fd <= 2 ? 2 : 4);
      view.setUint16(2, 0, true); // fs_flags
      view.setBigUint64(8, 0xffffffffffffffffn, true); // rights base
      view.setBigUint64(16, 0xffffffffffffffffn, true); // rights inheriting
      return 0;
    },

    fd_fdstat_set_flags: (fd, flags) => 0,
    fd_prestat_get: (fd, buf) => 8, // __WASI_ERRNO_BADF (no preopens)
    fd_prestat_dir_name: (fd, path, path_len) => 8,
    path_open: () => 44, // __WASI_ERRNO_NOENT
    path_filestat_get: () => 44,
    random_get: (buf, buf_len) => {
      const mem = getMemory();
      const u8 = new Uint8Array(mem.buffer, buf, buf_len);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(u8);
      } else {
        for (let i = 0; i < buf_len; i++) u8[i] = Math.floor(Math.random() * 256);
      }
      return 0;
    },
    sched_yield: () => 0
  };
}


// index.js - raylib-wasi Host Bridge entry point





function createRaylibHost(options = {}) {
  let memory = null;
  const getMemory = () => {
    if (!memory) throw new Error('WebAssembly memory not bound. Call host.setMemory(instance.exports.memory) or host.setInstance(instance)');
    return memory;
  };

  const utf8Decoder = new TextDecoder('utf-8');
  function decodeString(ptr) {
    if (ptr === 0) return '';
    const mem = getMemory();
    const u8 = new Uint8Array(mem.buffer, ptr);
    let end = 0;
    while (u8[end] !== 0) end++;
    return utf8Decoder.decode(new Uint8Array(mem.buffer, ptr, end));
  }

  // Initialize Canvas & WebGL Context
  let canvas = options.canvas || null;
  let gl = options.gl || null;
  if (!gl) {
    if (!canvas && typeof OffscreenCanvas !== 'undefined') {
      const w = options.width || 800;
      const h = options.height || 450;
      canvas = new OffscreenCanvas(w, h);
    }
    if (canvas && typeof canvas.getContext === 'function') {
      gl = canvas.getContext('webgl', {
        alpha: false,
        depth: true,
        stencil: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false
      });
    }
  }

  // Create sub-modules
  const input = new InputCoordinator({
    canvas,
    sharedBuffer: options.sharedBuffer || null,
    width: options.width || (canvas ? canvas.width : 800),
    height: options.height || (canvas ? canvas.height : 450),
    dpiScale: options.dpiScale || (typeof window !== 'undefined' ? window.devicePixelRatio : 1.0)
  });

  const glImports = gl ? createGLImports(gl, getMemory) : {};
  const wasiImports = createWasiImports(getMemory, options);

  const raylibImports = {
    raylib_host_init_window: (width, height, titlePtr) => {
      const title = decodeString(titlePtr);
      if (canvas) {
        if (!canvas.width) canvas.width = width;
        if (!canvas.height) canvas.height = height;
      }
      input.windowWidth = width;
      input.windowHeight = height;
      input.renderWidth = width;
      input.renderHeight = height;
      input.updateSharedState();
      if (typeof document !== 'undefined' && title) {
        document.title = title;
      }
      return 0;
    },

    raylib_host_close_window: () => {
      input.shouldClose = true;
      input.updateSharedState();
      if (options.onClose) options.onClose();
    },

    raylib_host_swap_buffers: () => {
      let bitmap = null;
      if (canvas && typeof canvas.transferToImageBitmap === 'function') {
        try {
          bitmap = canvas.transferToImageBitmap();
        } catch (_) {
          // Ignore if placeholder canvas or detached
        }
      }

      if (options.onFrame) {
        options.onFrame(bitmap);
      } else if (bitmap && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
        self.postMessage({ type: 'frame', bitmap }, [bitmap]);
      }

      // Legacy OffscreenCanvas commit if available
      if (gl && gl.commit) gl.commit();
    },

    raylib_host_poll_input: (statePtr) => {
      input.pollToWasm(statePtr, getMemory());
    },

    raylib_host_sleep: (ms) => {
      if (ms <= 0) return;
      if (input.syncWord) {
        // Synchronous frame delay via Atomics.wait on SharedArrayBuffer in Web Worker
        Atomics.wait(input.syncWord, 0, 0, Math.max(1, Math.round(ms)));
      } else if (typeof Atomics !== 'undefined' && options.sharedBuffer) {
        const sync = new Int32Array(options.sharedBuffer, 372, 1);
        Atomics.wait(sync, 0, 0, Math.max(1, Math.round(ms)));
      }
    },

    raylib_host_set_title: (titlePtr) => {
      const title = decodeString(titlePtr);
      if (typeof document !== 'undefined' && title) {
        document.title = title;
      }
    },

    raylib_host_open_url: (urlPtr) => {
      const url = decodeString(urlPtr);
      if (typeof window !== 'undefined' && url) {
        window.open(url, '_blank');
      }
    }
  };

  const host = {
    input,
    gl,
    getImports: () => ({
      gl: glImports,
      raylib: raylibImports,
      wasi_snapshot_preview1: wasiImports
    }),
    setMemory: (mem) => { memory = mem; },
    setInstance: (inst) => {
      memory = inst.exports.memory;
    },
    run: async (wasmBinary) => {
      const imports = host.getImports();
      const { instance } = await WebAssembly.instantiate(wasmBinary, imports);
      host.setInstance(instance);
      if (instance.exports._start) {
        instance.exports._start();
      } else if (instance.exports.main) {
        instance.exports.main();
      }
      return instance;
    }
  };

  return host;
}



export { createGLImports, InputCoordinator, createWasiImports, createRaylibHost };
export default createRaylibHost;
