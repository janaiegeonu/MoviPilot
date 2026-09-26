package storage

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"
)

func createSessionsTable() {

	query := `
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	`

	_, err := DB.Exec(query)
	if err != nil {
		panic("failed to create sessions table: " + err.Error())
	}
}

func CreateSession(userID int64) (string, error) {

	randomBytes := make([]byte, 32)

	_, err := rand.Read(randomBytes)
	if err != nil {
		return "", err
	}

	sessionID := hex.EncodeToString(randomBytes)

	expiresAt := time.Now().Add(7 * 24 * time.Hour).Unix()

	_, err = DB.Exec(`
		INSERT INTO sessions (
			id,
			user_id,
			expires_at,
			created_at
		)
		VALUES (?, ?, ?, ?)
	`,
		sessionID,
		userID,
		expiresAt,
		time.Now().Unix(),
	)

	if err != nil {
		return "", err
	}

	return sessionID, nil
}

func GetUserIDBySession(sessionID string) (int64, error) {

	var (
		userID    int64
		expiresAt int64
	)

	err := DB.QueryRow(`
		SELECT user_id, expires_at
		FROM sessions
		WHERE id = ?
	`, sessionID).Scan(
		&userID,
		&expiresAt,
	)

	if err != nil {
		return 0, err
	}

	if time.Now().Unix() >= expiresAt {

		_, _ = DB.Exec(`
			DELETE FROM sessions
			WHERE id = ?
		`, sessionID)

		return 0, sql.ErrNoRows
	}

	return userID, nil
}

func DeleteSession(sessionID string) error {

	_, err := DB.Exec(`
		DELETE FROM sessions
		WHERE id = ?
	`, sessionID)

	return err
}
