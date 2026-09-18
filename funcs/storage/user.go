package storage

import ( 
	"time"

)

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

func GetUserByEmail(email string) (User, error) {
	var user User

	err := DB.QueryRow(`
        SELECT id, full_name, email, password_hash, created_at
        FROM users
        WHERE email = ?
    `, email).Scan(
		&user.ID,
		&user.FullName,
		&user.Email,
		&user.PasswordHash,
		&user.CreatedAt,
	)

	if err != nil {
		return User{}, err
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
