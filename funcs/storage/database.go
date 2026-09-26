package storage

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

func RGBG(text string) string {

	G := "\033[32m"
	reset := "\033[0m"
	return G + text + reset
}

func RGBY(text string) string {

	Y := "\033[33m"
	reset := "\033[0m"
	return Y + text + reset
}

func RGBR(text string, err error) string {

	R := "\033[31m"
	reset := "\033[0m"
	return R + text + reset
}

var DB *sql.DB

func InitDatabase() {

	var err error

	DB, err = sql.Open("sqlite", "movipilot.db")
	if err != nil {
		log.Fatal(RGBR("Failed to open database:", err))
	}

	err = DB.Ping()
	if err != nil {
		log.Fatal(RGBR("Failed to connect to database:", err))
	}

	// Enable foreign keys.
	_, err = DB.Exec(`PRAGMA foreign_keys = ON`)
	if err != nil {
		log.Fatal(RGBR("Failed to enable foreign keys:", err))
	}

	log.Println(RGBG("SQLite database connected successfully"))

	createUsersTable()
	createPasswordResetCodesTable()
	createSessionsTable()
}

func createUsersTable() {

	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		full_name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL DEFAULT '',
		auth_provider TEXT NOT NULL DEFAULT 'local',
		google_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := DB.Exec(query)
	if err != nil {
		log.Fatal(RGBR("Failed to create users table:", err))
	}

	// Existing databases need to be migrated.
	migrateUsersTable()

	// Google ID must be unique when present.
	_, err = DB.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
		ON users(google_id)
		WHERE google_id IS NOT NULL AND google_id <> '';
	`)

	if err != nil {
		log.Fatal(RGBR("Failed to create Google ID index:", err))
	}

	log.Println(RGBG("Users table ready"))
}

func migrateUsersTable() {

	rows, err := DB.Query(`PRAGMA table_info(users)`)
	if err != nil {
		log.Fatal(RGBR("Failed to inspect users table:", err))
	}

	defer rows.Close()

	columns := make(map[string]bool)

	for rows.Next() {

		var (
			cid          int
			name         string
			dataType     string
			notNull      int
			defaultValue sql.NullString
			primaryKey   int
		)

		err := rows.Scan(
			&cid,
			&name,
			&dataType,
			&notNull,
			&defaultValue,
			&primaryKey,
		)

		if err != nil {
			log.Fatal(RGBR("Failed to read users table:", err))
		}

		columns[name] = true
	}

	if err := rows.Err(); err != nil {
		log.Fatal(RGBR("Failed while reading users table:", err))
	}

	// Add auth_provider to an existing database.
	if !columns["auth_provider"] {

		_, err := DB.Exec(`
			ALTER TABLE users
			ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'
		`)

		if err != nil {
			log.Fatal(RGBR("Failed to add auth_provider:", err))
		}

		log.Println(RGBG("Added auth_provider column"))
	}

	// Add google_id to an existing database.
	if !columns["google_id"] {

		_, err := DB.Exec(`
			ALTER TABLE users
			ADD COLUMN google_id TEXT
		`)

		if err != nil {
			log.Fatal(RGBR("Failed to add google_id:", err))
		}

		log.Println(RGBG("Added google_id column"))
	}
}

func createPasswordResetCodesTable() {

	query := `
	CREATE TABLE IF NOT EXISTS password_reset_codes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL,
		code_hash TEXT NOT NULL,
		expires_at DATETIME NOT NULL
	);
	`

	_, err := DB.Exec(query)
	if err != nil {
		log.Fatal(RGBR("Failed to create password reset codes table:", err))
	}

	log.Println(RGBG("Password reset codes table ready"))
}
