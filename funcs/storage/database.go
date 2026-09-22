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

	log.Println(RGBG("SQLite database connected successfully"))

	createUsersTable()
	createPasswordResetCodesTable()
}

func createUsersTable() {

	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		full_name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := DB.Exec(query)
	if err != nil {
		log.Fatal(RGBR("Failed to create users table:", err))
	}

	log.Println(RGBG("Users table ready"))
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
