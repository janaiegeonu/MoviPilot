package storage

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// CommunityMember contains public, non-sensitive data used by the Community UI.
// ID is only used internally by handlers and is never included in JSON responses.
type CommunityMember struct {
	ID          int64
	PublicID    string
	Username    string
	FullName    string
	CreatedAt   string
	FriendCount int64
	MarkedByMe  bool
	IsSelf      bool // True only when this result is the authenticated viewer.
}

// EnsureCommunitySchema safely adds the username field to older MoviPilot
// databases, backfills usernames, and creates the member-mark table and indexes.
// Call it once during InitDatabase, after createUsersTable has run.
func EnsureCommunitySchema() error {
	if DB == nil {
		return fmt.Errorf("community schema: database is not initialized")
	}

	columns := make(map[string]bool)
	rows, err := DB.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return fmt.Errorf("inspect users table: %w", err)
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read users table metadata: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate users table metadata: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close users table metadata: %w", err)
	}

	if !columns["username"] {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add users.username column: %w", err)
		}
	}

	if err := backfillCommunityUsernames(); err != nil {
		return err
	}

	if _, err := DB.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
		ON users(username COLLATE NOCASE);
	`); err != nil {
		return fmt.Errorf("create username index: %w", err)
	}

	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS community_friend_marks (
			user_id INTEGER NOT NULL,
			target_user_id INTEGER NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (user_id, target_user_id),
			CHECK (user_id <> target_user_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
		);
	`); err != nil {
		return fmt.Errorf("create community friend marks table: %w", err)
	}

	if _, err := DB.Exec(`
		CREATE INDEX IF NOT EXISTS idx_community_friend_marks_target
		ON community_friend_marks(target_user_id);
	`); err != nil {
		return fmt.Errorf("create community friend marks index: %w", err)
	}

	return nil
}

// newUsernameForName generates a readable, unique handle. The random suffix is
// not an authentication secret; it only prevents collisions between names.
// This helper is in the storage package so CreateUser and CreateGoogleUser can
// use the same policy as Community search.
func newUsernameForName(fullName string) (string, error) {
	base := usernameSlug(fullName)
	if base == "" {
		base = "movipilot"
	}

	for attempt := 0; attempt < 8; attempt++ {
		var randomBytes [4]byte
		if _, err := rand.Read(randomBytes[:]); err != nil {
			return "", fmt.Errorf("generate username suffix: %w", err)
		}
		candidate := base + "_" + hex.EncodeToString(randomBytes[:])
		var exists int
		err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM users WHERE username = ? COLLATE NOCASE)`, candidate).Scan(&exists)
		if err != nil {
			return "", fmt.Errorf("check username availability: %w", err)
		}
		if exists == 0 {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("could not generate a unique username after several attempts")
}

func usernameSlug(fullName string) string {
	var result strings.Builder
	lastSeparator := false
	runesWritten := 0
	for _, r := range strings.ToLower(strings.TrimSpace(fullName)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if runesWritten >= 24 {
				break
			}
			result.WriteRune(r)
			runesWritten++
			lastSeparator = false
			continue
		}
		if !lastSeparator && result.Len() > 0 {
			result.WriteByte('_')
			lastSeparator = true
		}
	}
	return strings.Trim(result.String(), "_")
}

func backfillCommunityUsernames() error {
	rows, err := DB.Query(`SELECT id, full_name, COALESCE(username, '') FROM users ORDER BY id`)
	if err != nil {
		return fmt.Errorf("read usernames for backfill: %w", err)
	}

	type accountRow struct {
		id       int64
		fullName string
		username string
	}
	accounts := make([]accountRow, 0)
	for rows.Next() {
		var account accountRow
		if err := rows.Scan(&account.id, &account.fullName, &account.username); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan username backfill row: %w", err)
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate username backfill rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close username backfill rows: %w", err)
	}

	// Preserve already-unique usernames, but repair every duplicate as a group.
	// This reserves handles that occur later in the rows too, preventing a blank
	// older account from accidentally taking a later account's existing handle.
	counts := make(map[string]int, len(accounts))
	for _, account := range accounts {
		key := strings.ToLower(strings.TrimSpace(account.username))
		if key != "" {
			counts[key]++
		}
	}

	seen := make(map[string]struct{}, len(accounts))
	for _, account := range accounts {
		key := strings.ToLower(strings.TrimSpace(account.username))
		if key != "" && counts[key] == 1 {
			seen[key] = struct{}{}
		}
	}

	for _, account := range accounts {
		key := strings.ToLower(strings.TrimSpace(account.username))
		if key != "" && counts[key] == 1 {
			continue
		}

		base := usernameSlug(account.fullName)
		if base == "" {
			base = "movipilot"
		}
		candidate := base
		if _, used := seen[strings.ToLower(candidate)]; used {
			candidate = base + "_" + strconv.FormatInt(account.id, 36)
		}
		for suffix := 2; ; suffix++ {
			if _, used := seen[strings.ToLower(candidate)]; !used {
				break
			}
			candidate = base + "_" + strconv.FormatInt(account.id, 36) + "_" + strconv.Itoa(suffix)
		}

		if _, err := DB.Exec(`UPDATE users SET username = ? WHERE id = ?`, candidate, account.id); err != nil {
			return fmt.Errorf("backfill username for user %d: %w", account.id, err)
		}
		seen[strings.ToLower(candidate)] = struct{}{}
	}
	return nil
}

// SearchCommunityMembers searches by exact public ID or username/full-name substring.
// The current viewer is included in matching results and is flagged with IsSelf.
// In username mode, the reserved query "ME" returns only the authenticated viewer.
func SearchCommunityMembers(viewerID int64, mode, query string, limit int) ([]CommunityMember, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not initialized")
	}
	query = strings.TrimSpace(query)
	if viewerID <= 0 || query == "" {
		return []CommunityMember{}, nil
	}
	if limit < 1 || limit > 20 {
		limit = 12
	}

	if mode == "id" {
		member, err := GetCommunityMemberByPublicID(viewerID, query)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return []CommunityMember{}, nil
			}
			return nil, err
		}
		member.IsSelf = member.ID == viewerID
		return []CommunityMember{member}, nil
	}

	// "ME" is a reserved self-discovery shortcut, not a public username query.
	if strings.EqualFold(query, "ME") {
		member, err := GetCommunityMemberByUserID(viewerID, viewerID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return []CommunityMember{}, nil
			}
			return nil, err
		}
		return []CommunityMember{member}, nil
	}

	rows, err := DB.Query(`
		SELECT
			u.id,
			u.public_id,
			u.username,
			u.full_name,
			CAST(u.created_at AS TEXT),
			(SELECT COUNT(*) FROM community_friend_marks fm WHERE fm.target_user_id = u.id) AS friend_count,
			EXISTS(SELECT 1 FROM community_friend_marks mine WHERE mine.user_id = ? AND mine.target_user_id = u.id) AS marked_by_me
		FROM users u
		WHERE (instr(lower(u.username), lower(?)) > 0 OR instr(lower(u.full_name), lower(?)) > 0)
		ORDER BY CASE
		           WHEN lower(u.username) = lower(?) THEN 0
		           WHEN lower(u.full_name) = lower(?) THEN 1
		           ELSE 2
		         END,
		         lower(u.username), u.id
		LIMIT ?
	`, viewerID, query, query, query, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search community members: %w", err)
	}
	defer rows.Close()

	members := make([]CommunityMember, 0, limit)
	for rows.Next() {
		member, err := scanCommunityMember(rows)
		if err != nil {
			return nil, fmt.Errorf("scan community search result: %w", err)
		}
		member.IsSelf = member.ID == viewerID
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate community search results: %w", err)
	}
	return members, nil
}

// GetCommunityMemberByPublicID returns only fields needed for the public member
// card plus an internal ID that handlers must never serialize to clients.
func GetCommunityMemberByPublicID(viewerID int64, publicID string) (CommunityMember, error) {
	var member CommunityMember
	var createdAt sql.NullString
	var markedByMe int
	err := DB.QueryRow(`
		SELECT
			u.id,
			u.public_id,
			u.username,
			u.full_name,
			CAST(u.created_at AS TEXT),
			(SELECT COUNT(*) FROM community_friend_marks fm WHERE fm.target_user_id = u.id),
			EXISTS(SELECT 1 FROM community_friend_marks mine WHERE mine.user_id = ? AND mine.target_user_id = u.id)
		FROM users u
		WHERE u.public_id = ? COLLATE NOCASE
		LIMIT 1
	`, viewerID, strings.TrimSpace(publicID)).Scan(
		&member.ID,
		&member.PublicID,
		&member.Username,
		&member.FullName,
		&createdAt,
		&member.FriendCount,
		&markedByMe,
	)
	if err != nil {
		return CommunityMember{}, err
	}
	if createdAt.Valid {
		member.CreatedAt = createdAt.String
	}
	member.MarkedByMe = markedByMe != 0
	member.IsSelf = member.ID == viewerID
	return member, nil
}

// GetCommunityMemberByUserID is used for the authenticated "ME" shortcut.
// Internal numeric IDs are accepted only inside the Go storage layer and are
// never serialized to Community API responses.
func GetCommunityMemberByUserID(viewerID, targetID int64) (CommunityMember, error) {
	if DB == nil {
		return CommunityMember{}, fmt.Errorf("database is not initialized")
	}
	if viewerID <= 0 || targetID <= 0 {
		return CommunityMember{}, fmt.Errorf("invalid account ID")
	}
	member, err := scanCommunityMember(DB.QueryRow(`
		SELECT
			u.id,
			u.public_id,
			u.username,
			u.full_name,
			CAST(u.created_at AS TEXT),
			(SELECT COUNT(*) FROM community_friend_marks fm WHERE fm.target_user_id = u.id),
			EXISTS(SELECT 1 FROM community_friend_marks mine WHERE mine.user_id = ? AND mine.target_user_id = u.id)
		FROM users u
		WHERE u.id = ?
		LIMIT 1
	`, viewerID, targetID))
	if err != nil {
		return CommunityMember{}, err
	}
	member.IsSelf = member.ID == viewerID
	return member, nil
}

type communityRowScanner interface {
	Scan(dest ...any) error
}

func scanCommunityMember(row communityRowScanner) (CommunityMember, error) {
	var member CommunityMember
	var createdAt sql.NullString
	var markedByMe int
	err := row.Scan(
		&member.ID,
		&member.PublicID,
		&member.Username,
		&member.FullName,
		&createdAt,
		&member.FriendCount,
		&markedByMe,
	)
	if err != nil {
		return CommunityMember{}, err
	}
	if createdAt.Valid {
		member.CreatedAt = createdAt.String
	}
	member.MarkedByMe = markedByMe != 0
	return member, nil
}

// SetCommunityFriendMark idempotently adds or removes the viewer's mark for a
// target account and returns the target's current total mark count.
func SetCommunityFriendMark(viewerID, targetID int64, marked bool) (int64, error) {
	if DB == nil {
		return 0, fmt.Errorf("database is not initialized")
	}
	if viewerID <= 0 || targetID <= 0 {
		return 0, fmt.Errorf("invalid account ID")
	}
	if viewerID == targetID {
		return 0, fmt.Errorf("you cannot mark your own account as a friend")
	}

	tx, err := DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin friend-mark transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if marked {
		_, err = tx.Exec(`
			INSERT OR IGNORE INTO community_friend_marks (user_id, target_user_id)
			VALUES (?, ?)
		`, viewerID, targetID)
	} else {
		_, err = tx.Exec(`DELETE FROM community_friend_marks WHERE user_id = ? AND target_user_id = ?`, viewerID, targetID)
	}
	if err != nil {
		return 0, fmt.Errorf("save friend mark: %w", err)
	}

	var count int64
	if err := tx.QueryRow(`SELECT COUNT(*) FROM community_friend_marks WHERE target_user_id = ?`, targetID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count friend marks: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit friend-mark transaction: %w", err)
	}
	return count, nil
}