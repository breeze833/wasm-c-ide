// Sysroot initialization for standard C/C++ headers in /usr/include
import { GRAPHICS_H, GRAPHICS_CANVAS_H } from 'canvas-wasi/headers';
import { TURTLE_HEADERS } from './turtle-headers.js';
import { RAYLIB_HEADERS } from './raylib-headers.js';
import { SQLITE_HEADERS } from './sqlite-headers.js';

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
  'limits.h': `/* Minimal limits.h */
#ifndef _LIMITS_H
#define _LIMITS_H

#define CHAR_BIT 8
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN (-128)
#define CHAR_MAX 127
#define SHRT_MIN (-32768)
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define INT_MIN (-2147483647 - 1)
#define INT_MAX 2147483647
#define UINT_MAX 4294967295U
#define LONG_MIN (-9223372036854775807L - 1L)
#define LONG_MAX 9223372036854775807L
#define ULONG_MAX 18446744073709551615UL
#define LLONG_MIN (-9223372036854775807LL - 1LL)
#define LLONG_MAX 9223372036854775807LL
#define ULLONG_MAX 18446744073709551615ULL
#define PATH_MAX 4096

#endif /* _LIMITS_H */
`,

  'float.h': `/* Minimal float.h */
#ifndef _FLOAT_H
#define _FLOAT_H

#define FLT_RADIX 2
#define FLT_MANT_DIG 24
#define FLT_DIG 6
#define FLT_ROUNDS 1
#define FLT_EPSILON 1.19209290e-7F
#define FLT_MIN 1.17549435e-38F
#define FLT_MAX 3.40282347e+38F

#define DBL_MANT_DIG 53
#define DBL_DIG 15
#define DBL_EPSILON 2.2204460492503131e-16
#define DBL_MIN 2.2250738585072014e-308
#define DBL_MAX 1.7976931348623157e+308

#endif /* _FLOAT_H */
`,

  'inttypes.h': `/* Minimal inttypes.h */
#ifndef _INTTYPES_H
#define _INTTYPES_H
#include <stdint.h>

#define PRId32 "d"
#define PRIu32 "u"
#define PRIx32 "x"
#define PRId64 "lld"
#define PRIu64 "llu"
#define PRIx64 "llx"
#define SCNd32 "d"
#define SCNu32 "u"
#define SCNd64 "lld"
#define SCNu64 "llu"

#endif /* _INTTYPES_H */
`,

  'fcntl.h': `/* Minimal fcntl.h */
#ifndef _FCNTL_H
#define _FCNTL_H

#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR   2
#define O_CREAT  0100
#define O_EXCL   0200
#define O_TRUNC  01000
#define O_APPEND 02000

#ifdef __cplusplus
extern "C" {
#endif

int open(const char *pathname, int flags, ...);
int creat(const char *pathname, mode_t mode);

#ifdef __cplusplus
}
#endif

#endif /* _FCNTL_H */
`,

  'sys/stat.h': `/* Minimal sys/stat.h */
#ifndef _SYS_STAT_H
#define _SYS_STAT_H

typedef unsigned int mode_t;
typedef unsigned long ino_t;
typedef unsigned long dev_t;
typedef unsigned int nlink_t;
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef long off_t;
typedef long time_t;

struct stat {
  dev_t st_dev;
  ino_t st_ino;
  mode_t st_mode;
  nlink_t st_nlink;
  uid_t st_uid;
  gid_t st_gid;
  off_t st_size;
  time_t st_atime;
  time_t st_mtime;
  time_t st_ctime;
};

#define S_IFMT  0170000
#define S_IFDIR 0040000
#define S_IFREG 0100000

#define S_ISDIR(m) (((m) & S_IFMT) == S_IFDIR)
#define S_ISREG(m) (((m) & S_IFMT) == S_IFREG)

#ifdef __cplusplus
extern "C" {
#endif

int stat(const char *pathname, struct stat *statbuf);
int fstat(int fd, struct stat *statbuf);
int mkdir(const char *pathname, mode_t mode);

#ifdef __cplusplus
}
#endif

#endif /* _SYS_STAT_H */
`,

  'sys/types.h': `/* Minimal sys/types.h */
#ifndef _SYS_TYPES_H
#define _SYS_TYPES_H

typedef unsigned long size_t;
typedef long ssize_t;
typedef long off_t;
typedef unsigned int mode_t;
typedef int pid_t;
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef long time_t;

#endif /* _SYS_TYPES_H */
`,

  'dirent.h': `/* Minimal dirent.h */
#ifndef _DIRENT_H
#define _DIRENT_H

typedef struct DIR DIR;

struct dirent {
  unsigned long d_ino;
  unsigned char d_type;
  char d_name[256];
};

#define DT_UNKNOWN 0
#define DT_DIR 4
#define DT_REG 8

#ifdef __cplusplus
extern "C" {
#endif

DIR *opendir(const char *name);
struct dirent *readdir(DIR *dirp);
int closedir(DIR *dirp);

#ifdef __cplusplus
}
#endif

#endif /* _DIRENT_H */
`,

  'graphics.h': GRAPHICS_H,
  'graphics_canvas.h': GRAPHICS_CANVAS_H,
  'turtle.h': TURTLE_HEADERS['turtle.h'],
  'turtle_backend_canvas_wasi.h': TURTLE_HEADERS['turtle_backend_canvas_wasi.h'],
  'turtle_backend_raylib.h': TURTLE_HEADERS['turtle_backend_raylib.h'],
  'raylib.h': RAYLIB_HEADERS['raylib.h'],
  'raymath.h': RAYLIB_HEADERS['raymath.h'],
  'rlgl.h': RAYLIB_HEADERS['rlgl.h'],
  'raygui.h': RAYLIB_HEADERS['raygui.h'],
  'sqlite3.h': SQLITE_HEADERS['sqlite3.h'],
  'sqlite3ext.h': SQLITE_HEADERS['sqlite3ext.h'],
};

export { TURTLE_HEADERS, RAYLIB_HEADERS, SQLITE_HEADERS };

export const STANDARD_CPP_HEADERS = {
  'cstdio': `// Minimal C++ cstdio header
#ifndef _CSTDIO_
#define _CSTDIO_
#include <stdio.h>
namespace std {
    using ::FILE;
    using ::size_t;
    using ::printf;
    using ::fprintf;
    using ::sprintf;
    using ::snprintf;
    using ::scanf;
    using ::sscanf;
    using ::fscanf;
    using ::putchar;
    using ::puts;
    using ::fputc;
    using ::fputs;
    using ::getchar;
    using ::fgets;
    using ::fgetc;
    using ::fopen;
    using ::fclose;
    using ::fread;
    using ::fwrite;
    using ::fflush;
    using ::fseek;
    using ::ftell;
    using ::feof;
    using ::ferror;
    using ::perror;
    using ::remove;
    using ::rename;
}
#endif
`,

  'cstdlib': `// Minimal C++ cstdlib header
#ifndef _CSTDLIB_
#define _CSTDLIB_
#include <stdlib.h>
namespace std {
    using ::size_t;
    using ::malloc;
    using ::calloc;
    using ::realloc;
    using ::free;
    using ::abort;
    using ::exit;
    using ::atexit;
    using ::atoi;
    using ::atol;
    using ::atof;
    using ::strtol;
    using ::strtoul;
    using ::strtod;
    using ::rand;
    using ::srand;
    using ::abs;
    using ::labs;
    using ::qsort;
    using ::bsearch;
}
#endif
`,

  'cstring': `// Minimal C++ cstring header
#ifndef _CSTRING_
#define _CSTRING_
#include <string.h>
namespace std {
    using ::size_t;
    using ::memcpy;
    using ::memmove;
    using ::memset;
    using ::memcmp;
    using ::memchr;
    using ::strlen;
    using ::strcpy;
    using ::strncpy;
    using ::strcat;
    using ::strncat;
    using ::strcmp;
    using ::strncmp;
    using ::strchr;
    using ::strrchr;
    using ::strstr;
    using ::strtok;
    using ::strerror;
}
#endif
`,

  'cmath': `// Minimal C++ cmath header
#ifndef _CMATH_
#define _CMATH_
#include <math.h>
namespace std {
    using ::sin;
    using ::cos;
    using ::tan;
    using ::asin;
    using ::acos;
    using ::atan;
    using ::atan2;
    using ::sinh;
    using ::cosh;
    using ::tanh;
    using ::exp;
    using ::log;
    using ::log10;
    using ::pow;
    using ::sqrt;
    using ::ceil;
    using ::floor;
    using ::fabs;
    using ::fmod;
}
#endif
`,

  'cctype': `// Minimal C++ cctype header
#ifndef _CCTYPE_
#define _CCTYPE_
#include <ctype.h>
namespace std {
    using ::isalnum;
    using ::isalpha;
    using ::iscntrl;
    using ::isdigit;
    using ::isgraph;
    using ::islower;
    using ::isprint;
    using ::ispunct;
    using ::isspace;
    using ::isupper;
    using ::isxdigit;
    using ::tolower;
    using ::toupper;
}
#endif
`,

  'cstddef': `// Minimal C++ cstddef header
#ifndef _CSTDDEF_
#define _CSTDDEF_
#include <stddef.h>
namespace std {
    using ::ptrdiff_t;
    using ::size_t;
}
#endif
`,

  'cstdint': `// Minimal C++ cstdint header
#ifndef _CSTDINT_
#define _CSTDINT_
#include <stdint.h>
namespace std {
    using ::int8_t;
    using ::int16_t;
    using ::int32_t;
    using ::int64_t;
    using ::uint8_t;
    using ::uint16_t;
    using ::uint32_t;
    using ::uint64_t;
    using ::intptr_t;
    using ::uintptr_t;
}
#endif
`,

  'cassert': `// Minimal C++ cassert header
#ifndef _CASSERT_
#define _CASSERT_
#include <assert.h>
#endif
`,

  'ctime': `// Minimal C++ ctime header
#ifndef _CTIME_
#define _CTIME_
#include <time.h>
namespace std {
    using ::clock_t;
    using ::time_t;
    using ::tm;
    using ::clock;
    using ::time;
    using ::difftime;
    using ::mktime;
    using ::asctime;
    using ::ctime;
    using ::gmtime;
    using ::localtime;
    using ::strftime;
}
#endif
`,

  'climits': `// Minimal C++ climits header
#ifndef _CLIMITS_
#define _CLIMITS_
#include <limits.h>
#endif
`,

  'cfloat': `// Minimal C++ cfloat header
#ifndef _CFLOAT_
#define _CFLOAT_
#include <float.h>
#endif
`,

  'cerrno': `// Minimal C++ cerrno header
#ifndef _CERRNO_
#define _CERRNO_
#include <errno.h>
#endif
`,

  'algorithm': `// Minimal C++ algorithm header
#ifndef _ALGORITHM_
#define _ALGORITHM_
#include <utility>
namespace std {
    template <typename T>
    inline const T& min(const T& a, const T& b) {
        return (b < a) ? b : a;
    }
    template <typename T>
    inline const T& max(const T& a, const T& b) {
        return (a < b) ? b : a;
    }
    template <typename T>
    inline void swap(T& a, T& b) {
        T tmp = static_cast<T&&>(a);
        a = static_cast<T&&>(b);
        b = static_cast<T&&>(tmp);
    }
    template <typename Iter, typename T>
    inline Iter find(Iter first, Iter last, const T& val) {
        for (; first != last; ++first) {
            if (*first == val) return first;
        }
        return last;
    }
    template <typename Iter>
    inline void reverse(Iter first, Iter last) {
        while (first != last && first != --last) {
            std::swap(*first++, *last);
        }
    }
    template <typename Iter>
    inline void sort(Iter first, Iter last) {
        for (Iter i = first; i != last; ++i) {
            for (Iter j = first; j < last - 1; ++j) {
                if (*(j + 1) < *j) {
                    std::swap(*j, *(j + 1));
                }
            }
        }
    }
}
#endif
`,

  'utility': `// Minimal C++ utility header
#ifndef _UTILITY_
#define _UTILITY_
namespace std {
    template <typename T>
    struct remove_reference { typedef T type; };
    template <typename T>
    struct remove_reference<T&> { typedef T type; };
    template <typename T>
    struct remove_reference<T&&> { typedef T type; };

    template <typename T>
    constexpr T&& forward(typename std::remove_reference<T>::type& t) noexcept {
        return static_cast<T&&>(t);
    }
    template <typename T>
    constexpr typename std::remove_reference<T>::type&& move(T&& t) noexcept {
        return static_cast<typename std::remove_reference<T>::type&&>(t);
    }
    template <typename T1, typename T2>
    struct pair {
        T1 first;
        T2 second;
        pair() : first(), second() {}
        pair(const T1& a, const T2& b) : first(a), second(b) {}
    };
    template <typename T1, typename T2>
    inline pair<T1, T2> make_pair(T1 a, T2 b) {
        return pair<T1, T2>(a, b);
    }
}
#endif
`,

  'memory': `// Minimal C++ memory header
#ifndef _MEMORY_
#define _MEMORY_
#include <utility>
namespace std {
    template <typename T>
    class unique_ptr {
    private:
        T* _ptr;
    public:
        explicit unique_ptr(T* p = nullptr) : _ptr(p) {}
        ~unique_ptr() { delete _ptr; }
        unique_ptr(const unique_ptr&) = delete;
        unique_ptr& operator=(const unique_ptr&) = delete;
        unique_ptr(unique_ptr&& other) noexcept : _ptr(other._ptr) { other._ptr = nullptr; }
        unique_ptr& operator=(unique_ptr&& other) noexcept {
            if (this != &other) {
                delete _ptr;
                _ptr = other._ptr;
                other._ptr = nullptr;
            }
            return *this;
        }
        T& operator*() const { return *_ptr; }
        T* operator->() const { return _ptr; }
        T* get() const { return _ptr; }
        explicit operator bool() const { return _ptr != nullptr; }
        T* release() {
            T* tmp = _ptr;
            _ptr = nullptr;
            return tmp;
        }
        void reset(T* p = nullptr) {
            delete _ptr;
            _ptr = p;
        }
    };
    template <typename T, typename... Args>
    inline unique_ptr<T> make_unique(Args&&... args) {
        return unique_ptr<T>(new T(static_cast<Args&&>(args)...));
    }
}
#endif
`,

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
        const res = await fetch(`${basePath}/${util.file}`);
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


