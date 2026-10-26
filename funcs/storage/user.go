package storage

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// User is the account record used by authentication and profile features.
// PasswordHash must never be returned in API responses or embedded in templates.
type User struct {
	ID           int64
	PublicID     string
	FullName     string
	Email        string
	PasswordHash string
	AuthProvider string
	GoogleID     string
	CreatedAt    time.Time
}

// CreateUser inserts a local account with a generated public MoviPilot ID and
// a unique Community username. InitDatabase initializes EnsureCommunitySchema
// before authentication handlers are allowed to create accounts.
func CreateUser(user User) error {
	if DB == nil {
		return fmt.Errorf("database is not initialized")
	}
	publicID, err := newPublicAccountID()
	if err != nil {
		return fmt.Errorf("generate public account ID: %w", err)
	}
	username, err := newUsernameForName(user.FullName)
	if err != nil {
		return fmt.Errorf("generate community username: %w", err)
	}

	_, err = DB.Exec(`
		INSERT INTO users (
			public_id,
			username,
			full_name,
			email,
			password_hash,
			auth_provider
		)
		VALUES (?, ?, ?, ?, ?, 'local')
	`, publicID, username, strings.TrimSpace(user.FullName), strings.TrimSpace(user.Email), user.PasswordHash)
	if err != nil {
		return fmt.Errorf("create local user: %w", err)
	}
	return nil
}

// CreateGoogleUser inserts a Google-authenticated account with a public ID and
// a unique Community username.
func CreateGoogleUser(fullName, email, googleID string) error {
	if DB == nil {
		return fmt.Errorf("database is not initialized")
	}
	publicID, err := newPublicAccountID()
	if err != nil {
		return fmt.Errorf("generate public account ID: %w", err)
	}
	username, err := newUsernameForName(fullName)
	if err != nil {
		return fmt.Errorf("generate community username: %w", err)
	}

	_, err = DB.Exec(`
		INSERT INTO users (
			public_id,
			username,
			full_name,
			email,
			password_hash,
			auth_provider,
			google_id
		)
		VALUES (?, ?, ?, ?, '', 'google', ?)
	`, publicID, username, strings.TrimSpace(fullName), strings.TrimSpace(email), strings.TrimSpace(googleID))
	if err != nil {
		return fmt.Errorf("create Google user: %w", err)
	}
	return nil
}

func GetUserByEmail(email string) (User, error) {
	var user User
	var googleID sql.NullString

	err := DB.QueryRow(`
		SELECT id, public_id, full_name, email, password_hash, auth_provider, google_id, created_at
		FROM users
		WHERE email = ?
	`, email).Scan(
		&user.ID,
		&user.PublicID,
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
		SELECT id, public_id, full_name, email, password_hash, auth_provider, google_id, created_at
		FROM users
		WHERE google_id = ?
	`, googleID).Scan(
		&user.ID,
		&user.PublicID,
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

// GetUserByID returns a user by the internal database primary key.
func GetUserByID(id int64) (User, error) {
	var user User
	var googleID sql.NullString

	err := DB.QueryRow(`
		SELECT id, public_id, full_name, email, password_hash, auth_provider, google_id, created_at
		FROM users
		WHERE id = ?
	`, id).Scan(
		&user.ID,
		&user.PublicID,
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

// GetUserByPublicID supports future account lookup using the shareable public ID.
func GetUserByPublicID(publicID string) (User, error) {
	var user User
	var googleID sql.NullString

	err := DB.QueryRow(`
		SELECT id, public_id, full_name, email, password_hash, auth_provider, google_id, created_at
		FROM users
		WHERE public_id = ?
	`, publicID).Scan(
		&user.ID,
		&user.PublicID,
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

func EmailExists(email string) (bool, error) {
	var exists bool
	err := DB.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)
	`, email).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// newPublicAccountID creates an alphanumeric, non-sequential lookup ID.
// It is an identifier, not an authentication secret.
func newPublicAccountID() (string, error) {
	var randomBytes [10]byte // 80 bits of randomness
	if _, err := rand.Read(randomBytes[:]); err != nil {
		return "", err
	}
	return "MP" + strings.ToUpper(hex.EncodeToString(randomBytes[:])), nil
}
