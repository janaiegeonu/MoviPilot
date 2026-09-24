package storage

import (
	"database/sql"
	"time"
)

func SavePasswordResetCode(
	email string,
	codeHash string,
	expiresAt time.Time,
) error {

	_, err := DB.Exec(`
		DELETE FROM password_reset_codes
		WHERE email = ?
	`,
		email,
	)

	if err != nil {
		return err
	}

	_, err = DB.Exec(`
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

//GET USER RESET CODE FROM DATABASE TABLE

func GetPasswordResetCode(email string) (string, time.Time, error) {

	var codeHash string
	var expiresAt time.Time

	err := DB.QueryRow(`
		SELECT code_hash, expires_at
		FROM password_reset_codes
		WHERE email = ?
		ORDER BY id DESC
		LIMIT 1
	`,
		email,
	).Scan(
		&codeHash,
		&expiresAt,
	)

	if err != nil {
		return "", time.Time{}, err
	}

	return codeHash, expiresAt, nil
}

//DELETE PASSWORD FROM DATABASE

func DeletePasswordResetCode(email string) error {

	_, err := DB.Exec(`
		DELETE FROM password_reset_codes
		WHERE email = ?
	`,
		email,
	)

	return err
}

func UpdateUserPassword(email string, passwordHash string) error {

	result, err := DB.Exec(`
        UPDATE users
        SET password_hash = ?
        WHERE email = ?
    `,
		passwordHash,
		email,
	)

	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}
