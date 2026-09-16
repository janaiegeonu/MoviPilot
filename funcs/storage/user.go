package storage

import "time"

type User struct {
	ID           int64
	FullName     string
	Email        string
	PasswordHash string
	CreatedAt    time.Time
}

func CreateUser(user User) error {
	query := `
		INSERT INTO users (full_name, email, password_hash)
		VALUES (?, ?, ?)
	`

	_, err := DB.Exec(
		query,
		user.FullName,
		user.Email,
		user.PasswordHash,
	)

	return err
}
