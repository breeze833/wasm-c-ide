/*
 * 09_sqlite_database.c - SQLite 3 In-Browser Database Operations & CLI Demo
 *
 * This example demonstrates:
 *   1. Opening an embedded SQLite database in /workspace/demo.db
 *   2. Creating a relational table with schema constraints
 *   3. Inserting rows using prepared statements and parameterized bindings
 *   4. Querying records with sqlite3_prepare_v2, sqlite3_step, and sqlite3_column_*
 *   5. Formatted tabular console output
 *
 * Compilation & Execution:
 *   gcc 09_sqlite_database.c -lsqlite3 -o demo
 *   ./demo
 *
 * Terminal Inspection:
 *   You can inspect and query demo.db directly using the built-in SQLite CLI:
 *   sqlite3 demo.db "SELECT * FROM learners;"
 *   sqlite3 demo.db ".schema"
 */

#include <stdio.h>
#include <stdlib.h>
#include <sqlite3.h>

int main(void) {
    sqlite3 *db = NULL;
    char *err_msg = NULL;
    int rc;

    printf("==========================================\n");
    printf("   SQLite 3 WASI Preview 1 Database Demo  \n");
    printf("==========================================\n\n");
    printf("SQLite Version: %s\n\n", sqlite3_libversion());

    // 1. Open database file in /workspace
    const char *db_path = "demo.db";
    printf("[1] Opening database '%s'...\n", db_path);
    rc = sqlite3_open(db_path, &db);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Error opening database: %s\n", sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }
    printf("    Database opened successfully.\n\n");

    // 2. Create table
    printf("[2] Creating table 'learners'...\n");
    const char *sql_create = 
        "CREATE TABLE IF NOT EXISTS learners ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  track TEXT NOT NULL,"
        "  score REAL NOT NULL"
        ");";

    rc = sqlite3_exec(db, sql_create, NULL, NULL, &err_msg);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "SQL error: %s\n", err_msg);
        sqlite3_free(err_msg);
        sqlite3_close(db);
        return 1;
    }
    printf("    Table 'learners' is ready.\n\n");

    // 3. Insert records using prepared statements
    printf("[3] Inserting student records via prepared statements...\n");
    const char *sql_insert = "INSERT INTO learners (name, track, score) VALUES (?, ?, ?);";
    sqlite3_stmt *stmt = NULL;

    rc = sqlite3_prepare_v2(db, sql_insert, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Failed to prepare insert statement: %s\n", sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }

    struct Student {
        const char *name;
        const char *track;
        double score;
    } students[] = {
        { "Alice Chen",   "Systems Programming", 98.5 },
        { "Bob Smith",    "Computer Graphics",   92.0 },
        { "Charlie Davis","Database Internals",  95.5 },
        { "Diana Prince", "WebAssembly & WASI",  99.0 },
    };
    int count = sizeof(students) / sizeof(students[0]);

    for (int i = 0; i < count; i++) {
        sqlite3_reset(stmt);
        sqlite3_bind_text(stmt, 1, students[i].name, -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 2, students[i].track, -1, SQLITE_STATIC);
        sqlite3_bind_double(stmt, 3, students[i].score);

        if (sqlite3_step(stmt) != SQLITE_DONE) {
            fprintf(stderr, "Execution failed: %s\n", sqlite3_errmsg(db));
        } else {
            printf("    + Inserted: %-14s | %-21s | %5.1f\n",
                   students[i].name, students[i].track, students[i].score);
        }
    }
    sqlite3_finalize(stmt);
    printf("\n");

    // 4. Query and display records
    printf("[4] Querying learners with score >= 95.0:\n");
    printf("    ----------------------------------------------------------\n");
    printf("    %-4s | %-16s | %-22s | %-5s\n", "ID", "Name", "Track", "Score");
    printf("    ----------------------------------------------------------\n");

    const char *sql_select = "SELECT id, name, track, score FROM learners WHERE score >= ? ORDER BY score DESC;";
    rc = sqlite3_prepare_v2(db, sql_select, -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_double(stmt, 1, 95.0);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            int id = sqlite3_column_int(stmt, 0);
            const unsigned char *name = sqlite3_column_text(stmt, 1);
            const unsigned char *track = sqlite3_column_text(stmt, 2);
            double score = sqlite3_column_double(stmt, 3);

            printf("    #%-3d | %-16s | %-22s | %5.1f\n", id, name, track, score);
        }
        sqlite3_finalize(stmt);
    }
    printf("    ----------------------------------------------------------\n\n");

    // 5. Aggregate statistics
    printf("[5] Calculating class statistics:\n");
    const char *sql_stats = "SELECT COUNT(*), AVG(score), MAX(score), MIN(score) FROM learners;";
    rc = sqlite3_prepare_v2(db, sql_stats, -1, &stmt, NULL);
    if (rc == SQLITE_OK && sqlite3_step(stmt) == SQLITE_ROW) {
        int total = sqlite3_column_int(stmt, 0);
        double avg = sqlite3_column_double(stmt, 1);
        double max = sqlite3_column_double(stmt, 2);
        double min = sqlite3_column_double(stmt, 3);

        printf("    Total students: %d\n", total);
        printf("    Average score:  %.2f\n", avg);
        printf("    Highest score:  %.1f\n", max);
        printf("    Lowest score:   %.1f\n", min);
        sqlite3_finalize(stmt);
    }
    printf("\n");

    // 6. Close database
    printf("[6] Closing database connection...\n");
    sqlite3_close(db);
    printf("    Database connection closed cleanly.\n");
    printf("\n[Hint] In xterm, inspect the database with:\n");
    printf("       sqlite3 demo.db \"SELECT * FROM learners;\"\n");

    return 0;
}
