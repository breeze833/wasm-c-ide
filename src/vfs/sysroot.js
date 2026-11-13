// Sysroot initialization for system commands, utilities, and host imports

export const STANDARD_LIBS = [
  'crt1.o',
  'libc.a',
  'libc++.a',
  'libc++abi.a',
  'libm.a',
  'libpthread.a',
  'libturtle.a',
  'libturtle_canvas-wasi.a',
  'libturtle_raylib.a',
  'libraylib.a',
  'libsqlite3.a',
];

export const BIN_COMMANDS = [
  'ash',
  'awk',
  'basename',
  'bc',
  'busybox',
  'cat',
  'cksum',
  'clear',
  'cmp',
  'comm',
  'cp',
  'crc32',
  'cut',
  'date',
  'dc',
  'diff',
  'dirname',
  'du',
  'echo',
  'egrep',
  'expr',
  'false',
  'fgrep',
  'find',
  'fold',
  'getopt',
  'grep',
  'gunzip',
  'gzip',
  'head',
  'hexdump',
  'httpd',
  'kill',
  'ls',
  'md5sum',
  'mkdir',
  'mktemp',
  'mv',
  'nproc',
  'paste',
  'printenv',
  'printf',
  'pwd',
  'readlink',
  'realpath',
  'rm',
  'rmdir',
  'sed',
  'seq',
  'sh',
  'sha1sum',
  'sha256sum',
  'sleep',
  'sort',
  'stat',
  'stty',
  'tac',
  'tail',
  'tar',
  'tee',
  'test',
  'touch',
  'tr',
  'true',
  'uname',
  'uniq',
  'unlink',
  'wc',
  'wget',
  'which',
  'xargs',
  'xxd',
  'yes',
];

export const USR_BIN_COMMANDS = [
  'gcc',
  'g++',
  'clang',
  'clang++',
  'clang-cpp',
  'ld',
  'lld',
  'wasm-ld',
  'ld.lld',
  'make',
  'ar',
  'ranlib',
  'nm',
  'objdump',
  'size',
  'c++filt',
  'cxxfilt',
  'strings',
  'readelf',
  'strip',
  'sqlite3',
];

export const WASM_HOST_IMPORTS = [
  // Generic Framebuffer Graphics (<graphics.h>)
  'graphics_init',
  'graphics_present',
  'graphics_present_rgba',
  'graphics_should_close',
  'graphics_close',
  'graphics_wait_frame',
  'graphics_get_mouse',
  'graphics_is_key_down',

  // HTML5 Canvas 2D Vector Primitives (<graphics_canvas.h>)
  'canvas_present',
  'canvas_clear_rect',
  'canvas_fill_rect',
  'canvas_stroke_rect',
  'canvas_begin_path',
  'canvas_close_path',
  'canvas_move_to',
  'canvas_line_to',
  'canvas_arc',
  'canvas_fill',
  'canvas_stroke',
  'canvas_set_fill_style',
  'canvas_set_stroke_style',
  'canvas_set_fill_rgb',
  'canvas_set_line_width',
  'canvas_set_line_cap',
  'canvas_fill_text',
  'canvas_stroke_text',
  'canvas_set_font',
  'canvas_save',
  'canvas_restore',
  'canvas_translate',
  'canvas_rotate',
  'canvas_scale',
  'canvas_get_image_data',
  'canvas_put_image_data',
  'canvas_get_pixels',
  'canvas_put_pixels',
  'canvas_get_pixel',
  'canvas_set_pixel',
];

export function mountSysroot(vfs) {
  // Mount /usr/lib static libraries stubs
  for (const lib of STANDARD_LIBS) {
    if (!vfs.exists(`/usr/lib/${lib}`)) {
      vfs.writeFile(`/usr/lib/${lib}`, `!<arch>\n/* ${lib} wasi-libc */\n`, Date.now(), true);
    }
  }

  // Mount /usr/lib/wasm-host-imports.txt for wasm-ld --allow-undefined-file
  vfs.writeFile('/usr/lib/wasm-host-imports.txt', WASM_HOST_IMPORTS.join('\n') + '\n', Date.now(), true);

  // Binary executable stub header (\0asm) for sysroot commands so BusyBox ash does not
  // interpret them as shell scripts and instead delegates toolchain commands to the host
  const wasmBinaryStub = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

  // Mount /bin built-in executables
  for (const cmd of BIN_COMMANDS) {
    if (!vfs.exists(`/bin/${cmd}`)) {
      vfs.writeFile(`/bin/${cmd}`, wasmBinaryStub, Date.now(), true);
    }
  }

  // Mount /usr/bin toolchain executables
  for (const cmd of USR_BIN_COMMANDS) {
    if (!vfs.exists(`/usr/bin/${cmd}`)) {
      vfs.writeFile(`/usr/bin/${cmd}`, wasmBinaryStub, Date.now(), true);
    }
  }
}

export const SYSROOT_UTILITIES = [
  {
    name: 'busybox',
    file: 'busybox.wasm',
    target: '/bin/busybox',
  },
  {
    name: 'sqlite3',
    file: 'sqlite3.wasm',
    target: '/usr/bin/sqlite3',
  },
  {
    name: 'make',
    file: 'make.wasm',
    target: '/usr/bin/make',
  },
];

/**
 * Mount prebuilt standalone utility executables (e.g. sqlite3.wasm) onto the master VFS.
 * These are user-facing CLI programs, separate from the compiler toolchain worker.
 */
export async function mountSysrootUtilities(vfs, basePath = '/sysroot/wasm') {
  await Promise.all(
    SYSROOT_UTILITIES.map(async (util) => {
      try {
        const res = await fetch(`${basePath}/${util.file}`, { cache: 'no-cache' });
        if (res && (res.ok || typeof res.ok === 'undefined')) {
          const buf = await res.arrayBuffer();
          vfs.writeFile(util.target, new Uint8Array(buf), Date.now(), true);
        }
      } catch (err) {
        console.warn(`Failed to mount sysroot utility ${util.name}:`, err);
      }
    })
  );
}
