package storage

import (
	"database/sql"
	"time"
)

type User struct {
	ID           int64
	FullName     string
	Email        string
	PasswordHash string
	AuthProvider string
	GoogleID     string
	CreatedAt    time.Time
}

func CreateUser(user User) error {

	query := `
		INSERT INTO users (
			full_name,
			email,
			password_hash,
			auth_provider
		)
		VALUES (?, ?, ?, 'local')
	`

	_, err := DB.Exec(
		query,
		user.FullName,
		user.Email,
		user.PasswordHash,
	)

	return err
}

func CreateGoogleUser(fullName, email, googleID string) error {

	query := `
		INSERT INTO users (
			full_name,
			email,
			password_hash,
			auth_provider,
			google_id
		)
		VALUES (?, ?, '', 'google', ?)
	`

	_, err := DB.Exec(
		query,
		fullName,
		email,
		googleID,
	)

	return err
}

func GetUserByEmail(email string) (User, error) {

	var user User

	var googleID sql.NullString

	err := DB.QueryRow(`
		SELECT
			id,
			full_name,
			email,
			password_hash,
			auth_provider,
			google_id,
			created_at
		FROM users
		WHERE email = ?
	`, email).Scan(
		&user.ID,
		&user.FullName,
		&user.Email,
		&user.PasswordHash,
		&user.AuthProvider,
		&googleID,
		&user.CreatedAt,
	)

	if err != nil {
		return User{}, err
	}

	if googleID.Valid {
		user.GoogleID = googleID.String
	}

	return user, nil
}

func GetUserByGoogleID(googleID string) (User, error) {

	var user User

	var storedGoogleID sql.NullString

	err := DB.QueryRow(`
		SELECT
			id,
			full_name,
			email,
			password_hash,
			auth_provider,
			google_id,
			created_at
		FROM users
		WHERE google_id = ?
	`, googleID).Scan(
		&user.ID,
		&user.FullName,
		&user.Email,
		&user.PasswordHash,
		&user.AuthProvider,
		&storedGoogleID,
		&user.CreatedAt,
	)

	if err != nil {
		return User{}, err
	}

	if storedGoogleID.Valid {
		user.GoogleID = storedGoogleID.String
	}

	return user, nil
}

func EmailExists(email string) (bool, error) {

	var exists bool

	err := DB.QueryRow(`
		SELECT EXISTS(
			SELECT 1
			FROM users
			WHERE email = ?
		)
	`, email).Scan(&exists)

	if err != nil {
		return false, err
	}

	return exists, nil
}
