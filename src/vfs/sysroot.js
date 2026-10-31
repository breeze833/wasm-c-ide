// Sysroot initialization for standard C/C++ headers in /usr/include
import { GRAPHICS_H, GRAPHICS_CANVAS_H } from 'canvas-wasi/headers';
import { TURTLE_HEADERS } from './turtle-headers.js';

export const STANDARD_C_HEADERS = {
  'stdio.h': `/* Minimal WASI / Musl stdio.h */
#ifndef _STDIO_H
#define _STDIO_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned long size_t;
typedef long ssize_t;
typedef struct _IO_FILE FILE;

extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;

#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

int printf(const char *format, ...);
int sprintf(char *str, const char *format, ...);
int snprintf(char *str, size_t size, const char *format, ...);
int fprintf(FILE *stream, const char *format, ...);
int scanf(const char *format, ...);
int sscanf(const char *str, const char *format, ...);
int fscanf(FILE *stream, const char *format, ...);

int putchar(int c);
int puts(const char *s);
int fputc(int c, FILE *stream);
int fputs(const char *s, FILE *stream);

int getchar(void);
char *fgets(char *s, int size, FILE *stream);
int fgetc(FILE *stream);

FILE *fopen(const char *pathname, const char *mode);
int fclose(FILE *stream);
size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream);
int fflush(FILE *stream);
int fseek(FILE *stream, long offset, int whence);
long ftell(FILE *stream);
int remove(const char *pathname);
int rename(const char *oldpath, const char *newpath);
int feof(FILE *stream);
int ferror(FILE *stream);
void perror(const char *s);

#ifdef __cplusplus
}
#endif

#endif /* _STDIO_H */
`,

  'stdlib.h': `/* Minimal WASI / Musl stdlib.h */
#ifndef _STDLIB_H
#define _STDLIB_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned long size_t;

#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define RAND_MAX 2147483647

void *malloc(size_t size);
void *calloc(size_t nmemb, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);

void abort(void);
void exit(int status);
int atexit(void (*function)(void));

int atoi(const char *nptr);
long atol(const char *nptr);
double atof(const char *nptr);
long strtol(const char *nptr, char **endptr, int base);
unsigned long strtoul(const char *nptr, char **endptr, int base);
double strtod(const char *nptr, char **endptr);

int rand(void);
void srand(unsigned int seed);

int abs(int j);
long labs(long j);

void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *));
void *bsearch(const void *key, const void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *));

#ifdef __cplusplus
}
#endif

#endif /* _STDLIB_H */
`,

  'string.h': `/* Minimal WASI / Musl string.h */
#ifndef _STRING_H
#define _STRING_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned long size_t;

void *memcpy(void *dest, const void *src, size_t n);
void *memmove(void *dest, const void *src, size_t n);
void *memset(void *s, int c, size_t n);
int memcmp(const void *s1, const void *s2, size_t n);
void *memchr(const void *s, int c, size_t n);

size_t strlen(const char *s);
char *strcpy(char *dest, const char *src);
char *strncpy(char *dest, const char *src, size_t n);
char *strcat(char *dest, const char *src);
char *strncat(char *dest, const char *src, size_t n);
int strcmp(const char *s1, const char *s2);
int strncmp(const char *s1, const char *s2, size_t n);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
char *strstr(const char *haystack, const char *needle);
char *strdup(const char *s);
char *strtok(char *str, const char *delim);
char *strerror(int errnum);

#ifdef __cplusplus
}
#endif

#endif /* _STRING_H */
`,

  'math.h': `/* Minimal WASI / Musl math.h */
#ifndef _MATH_H
#define _MATH_H

#ifdef __cplusplus
extern "C" {
#endif

#define M_PI 3.14159265358979323846
#define M_E  2.71828182845904523536

double sin(double x);
double cos(double x);
double tan(double x);
double asin(double x);
double acos(double x);
double atan(double x);
double atan2(double y, double x);

double sinh(double x);
double cosh(double x);
double tanh(double x);

double exp(double x);
double log(double x);
double log10(double x);
double pow(double x, double y);
double sqrt(double x);

double ceil(double x);
double floor(double x);
double fabs(double x);
double round(double x);
double fmod(double x, double y);

float sinf(float x);
float cosf(float x);
float sqrtf(float x);
float fabsf(float x);

#ifdef __cplusplus
}
#endif

#endif /* _MATH_H */
`,

  'stddef.h': `/* Minimal stddef.h */
#ifndef _STDDEF_H
#define _STDDEF_H

#ifndef NULL
#ifdef __cplusplus
#define NULL 0
#else
#define NULL ((void *)0)
#endif
#endif

typedef unsigned long size_t;
typedef long ptrdiff_t;
#ifndef __cplusplus
typedef int wchar_t;
#endif

#ifndef offsetof
#define offsetof(type, member) __builtin_offsetof(type, member)
#endif

#endif /* _STDDEF_H */
`,

  'stdint.h': `/* Minimal stdint.h */
#ifndef _STDINT_H
#define _STDINT_H

typedef signed char int8_t;
typedef short int16_t;
typedef int int32_t;
typedef long long int64_t;

typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
typedef unsigned long long uint64_t;

typedef long intptr_t;
typedef unsigned long uintptr_t;

#define INT8_MAX 127
#define INT8_MIN (-128)
#define INT16_MAX 32767
#define INT16_MIN (-32768)
#define INT32_MAX 2147483647
#define INT32_MIN (-2147483647 - 1)
#define INT64_MAX 9223372036854775807LL
#define INT64_MIN (-9223372036854775807LL - 1)

#define UINT8_MAX 255
#define UINT16_MAX 65535
#define UINT32_MAX 4294967295U
#define UINT64_MAX 18446744073709551615ULL

#endif /* _STDINT_H */
`,

  'stdbool.h': `/* Minimal stdbool.h */
#ifndef _STDBOOL_H
#define _STDBOOL_H

#ifndef __cplusplus
#define bool _Bool
#define true 1
#define false 0
#endif

#define __bool_true_false_are_defined 1

#endif /* _STDBOOL_H */
`,

  'assert.h': `/* Minimal assert.h */
#ifndef _ASSERT_H
#define _ASSERT_H

#ifdef NDEBUG
#define assert(expr) ((void)0)
#else
#ifdef __cplusplus
extern "C" {
#endif
void __assert_fail(const char *assertion, const char *file, unsigned int line, const char *function);
#ifdef __cplusplus
}
#endif
#define assert(expr) ((expr) ? (void)0 : __assert_fail(#expr, __FILE__, __LINE__, __func__))
#endif

#endif /* _ASSERT_H */
`,

  'ctype.h': `/* Minimal ctype.h */
#ifndef _CTYPE_H
#define _CTYPE_H

#ifdef __cplusplus
extern "C" {
#endif

int isalnum(int c);
int isalpha(int c);
int isdigit(int c);
int islower(int c);
int isupper(int c);
int isspace(int c);
int ispunct(int c);
int tolower(int c);
int toupper(int c);

#ifdef __cplusplus
}
#endif

#endif /* _CTYPE_H */
`,

  'time.h': `/* Minimal time.h */
#ifndef _TIME_H
#define _TIME_H

#ifdef __cplusplus
extern "C" {
#endif

typedef long time_t;
typedef long clock_t;

struct tm {
    int tm_sec;
    int tm_min;
    int tm_hour;
    int tm_mday;
    int tm_mon;
    int tm_year;
    int tm_wday;
    int tm_yday;
    int tm_isdst;
};

time_t time(time_t *tloc);
clock_t clock(void);
double difftime(time_t time1, time_t time0);
char *ctime(const time_t *timep);
char *asctime(const struct tm *tm);
struct tm *gmtime(const time_t *timep);
struct tm *localtime(const time_t *timep);

#ifdef __cplusplus
}
#endif

#endif /* _TIME_H */
`,

  'unistd.h': `/* Minimal unistd.h */
#ifndef _UNISTD_H
#define _UNISTD_H

#ifdef __cplusplus
extern "C" {
#endif

typedef long ssize_t;
typedef unsigned long size_t;

ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
int close(int fd);
int usleep(unsigned int usec);
unsigned int sleep(unsigned int seconds);

#ifdef __cplusplus
}
#endif

#endif /* _UNISTD_H */
`,

  'stdarg.h': `/* Standard stdarg.h */
#ifndef _STDARG_H
#define _STDARG_H

#define va_start(v,l)   __builtin_va_start(v,l)
#define va_end(v)       __builtin_va_end(v)
#define va_arg(v,l)     __builtin_va_arg(v,l)
#define va_copy(d,s)    __builtin_va_copy(d,s)
typedef __builtin_va_list va_list;

#endif /* _STDARG_H */
`,

  'errno.h': `/* Minimal errno.h */
#ifndef _ERRNO_H
#define _ERRNO_H

#ifdef __cplusplus
extern "C" {
#endif

extern int errno;

#define ENOENT 2
#define EACCES 13
#define EEXIST 17
#define EINVAL 22
#define ENOMEM 12

#ifdef __cplusplus
}
#endif

#endif /* _ERRNO_H */
`,

  'graphics.h': GRAPHICS_H,
  'graphics_canvas.h': GRAPHICS_CANVAS_H,
  'turtle.h': TURTLE_HEADERS['turtle.h'],
  'turtle_backend_canvas_wasi.h': TURTLE_HEADERS['turtle_backend_canvas_wasi.h'],
};

export { TURTLE_HEADERS };

export const STANDARD_CPP_HEADERS = {
  'iostream': `// Minimal C++ iostream header
#ifndef _IOSTREAM_
#define _IOSTREAM_

#include <stdio.h>
#include <string>

namespace std {
    class ostream {
    public:
        ostream& operator<<(const char* s) {
            printf("%s", s);
            return *this;
        }
        ostream& operator<<(int val) {
            printf("%d", val);
            return *this;
        }
        ostream& operator<<(double val) {
            printf("%f", val);
            return *this;
        }
        ostream& operator<<(char c) {
            putchar(c);
            return *this;
        }
        ostream& operator<<(const std::string& str);
        ostream& operator<<(ostream& (*manip)(ostream&)) {
            return manip(*this);
        }
    };

    class istream {
    public:
        istream& operator>>(int& val) {
            scanf("%d", &val);
            return *this;
        }
        istream& operator>>(double& val) {
            scanf("%lf", &val);
            return *this;
        }
        istream& operator>>(char& c) {
            scanf(" %c", &c);
            return *this;
        }
        istream& operator>>(std::string& str);
    };

    inline ostream& endl(ostream& os) {
        os << '\\n';
        fflush(stdout);
        return os;
    }

    extern ostream cout;
    extern istream cin;
    extern ostream cerr;
}

#endif // _IOSTREAM_
`,

  'string': `// Minimal C++ string header
#ifndef _STRING_CPP_
#define _STRING_CPP_

#include <string.h>
#include <stdlib.h>

namespace std {
    class string {
    private:
        char* _data;
        size_t _len;
    public:
        string() : _data(nullptr), _len(0) {
            _data = (char*)malloc(1);
            _data[0] = '\\0';
        }
        string(const char* s) {
            _len = strlen(s);
            _data = (char*)malloc(_len + 1);
            strcpy(_data, s);
        }
        string(const string& other) {
            _len = other._len;
            _data = (char*)malloc(_len + 1);
            strcpy(_data, other._data);
        }
        ~string() {
            if (_data) free(_data);
        }
        const char* c_str() const { return _data; }
        size_t length() const { return _len; }
        size_t size() const { return _len; }
        bool empty() const { return _len == 0; }
        bool operator==(const char* other) const {
            if (!_data || !other) return _data == other;
            return strcmp(_data, other) == 0;
        }
        bool operator==(const string& other) const {
            if (!_data || !other._data) return _data == other._data;
            return strcmp(_data, other._data) == 0;
        }
    };
    inline bool operator==(const char* a, const string& b) {
        return b == a;
    }
}

#endif // _STRING_CPP_
`,

  'fstream': `// Minimal C++ fstream header
#ifndef _FSTREAM_
#define _FSTREAM_

#include <stdio.h>
#include <string>

namespace std {

class ofstream {
private:
    FILE* _f;
public:
    ofstream() : _f(nullptr) {}
    explicit ofstream(const char* filename, const char* mode = "w") {
        _f = fopen(filename, mode);
    }
    explicit ofstream(const std::string& filename, const char* mode = "w") {
        _f = fopen(filename.c_str(), mode);
    }
    ~ofstream() {
        close();
    }
    bool is_open() const { return _f != nullptr; }
    void open(const char* filename, const char* mode = "w") {
        if (_f) fclose(_f);
        _f = fopen(filename, mode);
    }
    void close() {
        if (_f) {
            fclose(_f);
            _f = nullptr;
        }
    }
    ofstream& operator<<(const char* s) {
        if (_f) fputs(s, _f);
        return *this;
    }
    ofstream& operator<<(const std::string& s) {
        if (_f) fputs(s.c_str(), _f);
        return *this;
    }
    ofstream& operator<<(int val) {
        if (_f) fprintf(_f, "%d", val);
        return *this;
    }
    ofstream& operator<<(double val) {
        if (_f) fprintf(_f, "%g", val);
        return *this;
    }
    ofstream& operator<<(char c) {
        if (_f) fputc(c, _f);
        return *this;
    }
    ofstream& operator<<(ofstream& (*manip)(ofstream&)) {
        return manip(*this);
    }
};

inline ofstream& endl(ofstream& os) {
    os << '\\n';
    return os;
}

class ifstream {
private:
    FILE* _f;
public:
    ifstream() : _f(nullptr) {}
    explicit ifstream(const char* filename, const char* mode = "r") {
        _f = fopen(filename, mode);
    }
    explicit ifstream(const std::string& filename, const char* mode = "r") {
        _f = fopen(filename.c_str(), mode);
    }
    ~ifstream() {
        close();
    }
    bool is_open() const { return _f != nullptr; }
    void open(const char* filename, const char* mode = "r") {
        if (_f) fclose(_f);
        _f = fopen(filename, mode);
    }
    void close() {
        if (_f) {
            fclose(_f);
            _f = nullptr;
        }
    }
    ifstream& operator>>(int& val) {
        if (_f) fscanf(_f, "%d", &val);
        return *this;
    }
    ifstream& operator>>(double& val) {
        if (_f) fscanf(_f, "%lf", &val);
        return *this;
    }
    ifstream& operator>>(char& c) {
        if (_f) fscanf(_f, " %c", &c);
        return *this;
    }
    ifstream& operator>>(std::string& str) {
        if (_f) {
            char buf[512];
            if (fscanf(_f, "%511s", buf) == 1) {
                str = std::string(buf);
            }
        }
        return *this;
    }
    FILE* handle() const { return _f; }
};

inline bool getline(ifstream& is, std::string& str) {
    if (!is.is_open()) return false;
    char buf[1024];
    if (fgets(buf, sizeof(buf), is.handle())) {
        size_t len = strlen(buf);
        if (len > 0 && (buf[len - 1] == '\\n' || buf[len - 1] == '\\r')) {
            buf[len - 1] = '\\0';
            if (len > 1 && buf[len - 2] == '\\r') {
                buf[len - 2] = '\\0';
            }
        }
        str = std::string(buf);
        return true;
    }
    return false;
}

} // namespace std

#endif // _FSTREAM_
`,

  'vector': `// Minimal C++ vector header
#ifndef _VECTOR_
#define _VECTOR_

#include <stdlib.h>

namespace std {
    template <typename T>
    class vector {
    private:
        T* _data;
        size_t _size;
        size_t _capacity;
    public:
        vector() : _data(nullptr), _size(0), _capacity(0) {}
        ~vector() { if (_data) free(_data); }
        size_t size() const { return _size; }
        bool empty() const { return _size == 0; }
        void push_back(const T& val) {
            if (_size >= _capacity) {
                _capacity = _capacity == 0 ? 4 : _capacity * 2;
                _data = (T*)realloc(_data, _capacity * sizeof(T));
            }
            _data[_size++] = val;
        }
        T& operator[](size_t index) { return _data[index]; }
        const T& operator[](size_t index) const { return _data[index]; }
    };
}

#endif // _VECTOR_
`
};

export const STANDARD_LIBS = [
  'crt1.o',
  'libc.a',
  'libc++.a',
  'libc++abi.a',
  'libm.a',
  'libpthread.a',
  'libturtle.a',
  'libturtle_canvas-wasi.a',
];

export const BIN_COMMANDS = [
  'sh',
  'ls',
  'cat',
  'rm',
  'mkdir',
  'cp',
  'mv',
  'pwd',
  'clear',
  'echo',
  'pushd',
  'popd',
  'dirs',
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
];

export function mountSysroot(vfs) {
  // Mount C standard headers
  for (const [filename, content] of Object.entries(STANDARD_C_HEADERS)) {
    vfs.writeFile(`/usr/include/${filename}`, content, Date.now(), true);
  }

  // Mount C++ headers
  for (const [filename, content] of Object.entries(STANDARD_CPP_HEADERS)) {
    vfs.writeFile(`/usr/include/${filename}`, content, Date.now(), true);
  }

  // Mount /usr/lib static libraries
  for (const lib of STANDARD_LIBS) {
    if (!vfs.exists(`/usr/lib/${lib}`)) {
      vfs.writeFile(`/usr/lib/${lib}`, `!<arch>\n/* ${lib} wasi-libc */\n`, Date.now(), true);
    }
  }

  // Mount /bin built-in executables
  for (const cmd of BIN_COMMANDS) {
    vfs.writeFile(`/bin/${cmd}`, `#!/bin/sh\n# Built-in utility: ${cmd}\n`, Date.now(), true);
  }

  // Mount /usr/bin toolchain executables
  for (const cmd of USR_BIN_COMMANDS) {
    vfs.writeFile(`/usr/bin/${cmd}`, `#!/bin/sh\n# Toolchain binary: ${cmd}\n`, Date.now(), true);
  }
}

export function mountRaylibSysroot(vfs, headers = {}, libBuffer = null, turtleHeaders = {}, turtleRaylibLib = null) {
  if (headers['raylib.h']) {
    vfs.writeFile('/usr/include/raylib.h', headers['raylib.h'], Date.now(), true);
  }
  if (headers['raymath.h']) {
    vfs.writeFile('/usr/include/raymath.h', headers['raymath.h'], Date.now(), true);
  }
  if (headers['rlgl.h']) {
    vfs.writeFile('/usr/include/rlgl.h', headers['rlgl.h'], Date.now(), true);
  }
  if (libBuffer) {
    vfs.writeFile('/usr/lib/libraylib.a', libBuffer, Date.now(), true);
  }

  // Mount Raylib backend for turtle graphics
  const raylibTurtleHeader = headers['turtle_backend_raylib.h'] || turtleHeaders['turtle_backend_raylib.h'] || TURTLE_HEADERS['turtle_backend_raylib.h'];
  if (raylibTurtleHeader) {
    vfs.writeFile('/usr/include/turtle_backend_raylib.h', raylibTurtleHeader, Date.now(), true);
  }
  const raylibTurtleLibBuffer = turtleRaylibLib || headers['libturtle_raylib.a'];
  if (raylibTurtleLibBuffer) {
    vfs.writeFile('/usr/lib/libturtle_raylib.a', raylibTurtleLibBuffer, Date.now(), true);
  }
}

export function unmountRaylibSysroot(vfs, toolchain = null) {
  if (vfs.exists('/usr/include/raylib.h')) vfs.remove('/usr/include/raylib.h', false, true);
  if (vfs.exists('/usr/include/raymath.h')) vfs.remove('/usr/include/raymath.h', false, true);
  if (vfs.exists('/usr/include/rlgl.h')) vfs.remove('/usr/include/rlgl.h', false, true);
  if (vfs.exists('/usr/lib/libraylib.a')) vfs.remove('/usr/lib/libraylib.a', false, true);

  // Unmount Raylib turtle backend
  if (vfs.exists('/usr/include/turtle_backend_raylib.h')) vfs.remove('/usr/include/turtle_backend_raylib.h', false, true);
  if (vfs.exists('/usr/lib/libturtle_raylib.a')) vfs.remove('/usr/lib/libturtle_raylib.a', false, true);

  if (toolchain && typeof toolchain.removeFile === 'function') {
    toolchain.removeFile('include/raylib.h');
    toolchain.removeFile('include/raymath.h');
    toolchain.removeFile('include/rlgl.h');
    toolchain.removeFile('usr/lib/libraylib.a');
    toolchain.removeFile('lib/wasm32-wasi/libraylib.a');
    toolchain.removeFile('lib/wasm32-wasip1/libraylib.a');

    toolchain.removeFile('include/turtle_backend_raylib.h');
    toolchain.removeFile('usr/lib/libturtle_raylib.a');
    toolchain.removeFile('lib/wasm32-wasi/libturtle_raylib.a');
    toolchain.removeFile('lib/wasm32-wasip1/libturtle_raylib.a');
  }
}

