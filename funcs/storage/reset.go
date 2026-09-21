package storage

import "time"

func SavePasswordResetCode(email string, codeHash string, expiresAt time.Time) error {

	_, err := DB.Exec(`
		INSERT INTO password_reset_codes
		(email, code_hash, expires_at)
		VALUES (?, ?, ?)
	`,
		email,
		codeHash,
		expiresAt,
	)

	return err
}
