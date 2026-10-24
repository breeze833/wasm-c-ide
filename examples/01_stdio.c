/*
 * 01_stdio.c - Standard I/O Interactive Program
 *
 * Demonstrates:
 * - Interactive console standard I/O (printf, scanf, fgets)
 * - Input validation and basic computation
 *
 * Compilation in IDE Terminal:
 *   gcc 01_stdio.c -o a.out
 *   ./a.out
 */

#include <stdio.h>
#include <stdlib.h>

void show_menu(void) {
    printf("\n========================================\n");
    printf("   Interactive C Math & Text Console    \n");
    printf("========================================\n");
    printf("1. Calculate Fibonacci sequence\n");
    printf("2. Compute Factorial\n");
    printf("3. Prime number tester\n");
    printf("4. Exit\n");
    printf("Enter choice (1-4): ");
    fflush(stdout);
}

void fibonacci(void) {
    int n;
    printf("\n[Fibonacci] Enter number of terms (1-30): ");
    fflush(stdout);
    if (scanf("%d", &n) != 1 || n < 1 || n > 30) {
        printf("Invalid input! Please enter a number between 1 and 30.\n");
        return;
    }

    long long a = 0, b = 1;
    printf("Fibonacci sequence: ");
    for (int i = 0; i < n; i++) {
        printf("%lld ", a);
        long long next = a + b;
        a = b;
        b = next;
    }
    printf("\n");
}

void factorial(void) {
    int n;
    printf("\n[Factorial] Enter a non-negative integer (0-15): ");
    fflush(stdout);
    if (scanf("%d", &n) != 1 || n < 0 || n > 15) {
        printf("Invalid input! Please enter a number between 0 and 15.\n");
        return;
    }

    long long fact = 1;
    for (int i = 1; i <= n; i++) {
        fact *= i;
    }
    printf("%d! = %lld\n", n, fact);
}

void prime_check(void) {
    int n;
    printf("\n[Prime Check] Enter an integer >= 2: ");
    fflush(stdout);
    if (scanf("%d", &n) != 1 || n < 2) {
        printf("Invalid input! Please enter a number >= 2.\n");
        return;
    }

    int is_prime = 1;
    for (int i = 2; i * i <= n; i++) {
        if (n % i == 0) {
            is_prime = 0;
            break;
        }
    }

    if (is_prime) {
        printf("%d is a PRIME number!\n", n);
    } else {
        printf("%d is NOT a prime number (composite).\n", n);
    }
}

int main(void) {
    // Disable stdout buffering so prompts without trailing newline display immediately
    setbuf(stdout, NULL);

    char name[64];
    printf("Welcome to the In-Browser C/C++ IDE!\n");
    printf("Please enter your name: ");
    fflush(stdout);
    if (scanf("%63s", name) != 1) {
        return 0;
    }

    printf("Hello, %s! Let's run some interactive computations.\n", name);

    int choice = 0;
    while (1) {
        show_menu();
        if (scanf("%d", &choice) != 1) {
            printf("\nExiting. Goodbye, %s!\n", name);
            break;
        }

        switch (choice) {
            case 1: fibonacci(); break;
            case 2: factorial(); break;
            case 3: prime_check(); break;
            case 4:
                printf("\nExiting. Goodbye, %s!\n", name);
                return 0;
            default:
                printf("Invalid selection! Please choose an option 1-4.\n");
        }
    }

    return 0;
}
