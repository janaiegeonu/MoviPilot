package storage

import (
	"database/sql"
	"log"
	"strings"

	_ "modernc.org/sqlite"
)

func RGBG(text string) string {
	return "\033[32m" + text + "\033[0m"
}

func RGBY(text string) string {
	return "\033[33m" + text + "\033[0m"
}

func RGBR(text string, err error) string {
	_ = err
	return "\033[31m" + text + "\033[0m"
}

var DB *sql.DB

// InitDatabase keeps its existing no-return signature so callers in the app
// do not need to change. A schema failure is fatal: the server must not start
// with only part of the collection/community tables initialized.
func InitDatabase() {
	var err error
	DB, err = sql.Open("sqlite", "movipilot.db")
	if err != nil {
		log.Fatal(RGBR("Failed to open database: "+err.Error(), err))
	}

	if err = DB.Ping(); err != nil {
		log.Fatal(RGBR("Failed to connect to database: "+err.Error(), err))
	}

	if _, err = DB.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		log.Fatal(RGBR("Failed to enable foreign keys: "+err.Error(), err))
	}

	log.Println(RGBG("SQLite database connected successfully"))

	// The account table and its auth/public-ID migrations must exist before
	// Community, Explore, Personal Library, or Collection Hub migrations run.
	createUsersTable()

	if err := EnsureExploreTables(); err != nil {
		log.Fatal(RGBR("Failed to prepare Explore schema: "+err.Error(), err))
	}
	if err := EnsureCommunitySchema(); err != nil {
		log.Fatal(RGBR("Failed to prepare Community schema: "+err.Error(), err))
	}
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		log.Fatal(RGBR("Failed to prepare Explore personal library schema: "+err.Error(), err))
	}
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		log.Fatal(RGBR("Failed to prepare Collection Hub schema: "+err.Error(), err))
	}

	createPasswordResetCodesTable()
	createSessionsTable()
}

func createUsersTable() {
	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		public_id TEXT NOT NULL DEFAULT '',
		full_name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL DEFAULT '',
		auth_provider TEXT NOT NULL DEFAULT 'local',
		google_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	if _, err := DB.Exec(query); err != nil {
		log.Fatal(RGBR("Failed to create users table: "+err.Error(), err))
	}

	migrateUsersTable()
	ensurePublicAccountIDs()

	if _, err := DB.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
		ON users(google_id)
		WHERE google_id IS NOT NULL AND google_id <> '';
	`); err != nil {
		log.Fatal(RGBR("Failed to create Google ID index: "+err.Error(), err))
	}

	if _, err := DB.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id
		ON users(public_id)
		WHERE public_id IS NOT NULL AND public_id <> '';
	`); err != nil {
		log.Fatal(RGBR("Failed to create public account ID index: "+err.Error(), err))
	}

	log.Println(RGBG("Users table ready"))
}

// migrateUsersTable keeps existing SQLite databases compatible with current
// auth fields and the persistent public account ID. The Community migration
// adds username later, after all existing accounts can be read safely.
func migrateUsersTable() {
	rows, err := DB.Query(`PRAGMA table_info(users)`)
	if err != nil {
		log.Fatal(RGBR("Failed to inspect users table: "+err.Error(), err))
	}

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
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			log.Fatal(RGBR("Failed to read users table: "+err.Error(), err))
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		log.Fatal(RGBR("Failed while reading users table: "+err.Error(), err))
	}
	if err := rows.Close(); err != nil {
		log.Fatal(RGBR("Failed to close users table metadata: "+err.Error(), err))
	}

	if !columns["auth_provider"] {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'`); err != nil {
			log.Fatal(RGBR("Failed to add auth_provider: "+err.Error(), err))
		}
		log.Println(RGBG("Added auth_provider column"))
	}

	if !columns["google_id"] {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN google_id TEXT`); err != nil {
			log.Fatal(RGBR("Failed to add google_id: "+err.Error(), err))
		}
		log.Println(RGBG("Added google_id column"))
	}

	if !columns["public_id"] {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN public_id TEXT NOT NULL DEFAULT ''`); err != nil {
			log.Fatal(RGBR("Failed to add public_id: "+err.Error(), err))
		}
		log.Println(RGBG("Added public_id column"))
	}
}

// ensurePublicAccountIDs fills IDs on legacy accounts and repairs empty or
// duplicated values before the unique index is created.
func ensurePublicAccountIDs() {
	type accountIDRow struct {
		userID   int64
		publicID string
	}

	rows, err := DB.Query(`SELECT id, COALESCE(public_id, '') FROM users ORDER BY id`)
	if err != nil {
		log.Fatal(RGBR("Failed to load account IDs: "+err.Error(), err))
	}

	allRows := make([]accountIDRow, 0)
	for rows.Next() {
		var row accountIDRow
		if err := rows.Scan(&row.userID, &row.publicID); err != nil {
			_ = rows.Close()
			log.Fatal(RGBR("Failed to read account ID: "+err.Error(), err))
		}
		row.publicID = strings.TrimSpace(row.publicID)
		allRows = append(allRows, row)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		log.Fatal(RGBR("Failed while reading account IDs: "+err.Error(), err))
	}
	if err := rows.Close(); err != nil {
		log.Fatal(RGBR("Failed to close account IDs: "+err.Error(), err))
	}

	seen := make(map[string]struct{}, len(allRows))
	needsNewID := make([]int64, 0)
	for _, row := range allRows {
		if row.publicID == "" {
			needsNewID = append(needsNewID, row.userID)
			continue
		}
		if _, exists := seen[row.publicID]; exists {
			needsNewID = append(needsNewID, row.userID)
			continue
		}
		seen[row.publicID] = struct{}{}
	}

	for _, userID := range needsNewID {
		assigned := false
		for attempt := 0; attempt < 5; attempt++ {
			publicID, err := newPublicAccountID()
			if err != nil {
				log.Fatal(RGBR("Failed to generate a public account ID: "+err.Error(), err))
			}
			if _, exists := seen[publicID]; exists {
				continue
			}
			if _, err := DB.Exec(`UPDATE users SET public_id = ? WHERE id = ?`, publicID, userID); err != nil {
				log.Fatal(RGBR("Failed to update a public account ID: "+err.Error(), err))
			}
			seen[publicID] = struct{}{}
			assigned = true
			break
		}
		if !assigned {
			log.Fatal("Failed to assign a unique public account ID after several attempts")
		}
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
	if _, err := DB.Exec(query); err != nil {
		log.Fatal(RGBR("Failed to create password reset codes table: "+err.Error(), err))
	}
	log.Println(RGBG("Password reset codes table ready"))
}