package storage

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
)

type CommunityChatPresence struct {
	PublicID   string `json:"publicId"`
	Username   string `json:"username"`
	FullName   string `json:"fullName"`
	LastSeenAt string `json:"lastSeenAt"`
	IsOnline   bool   `json:"isOnline"`
}

type CommunityChatMentionMember struct {
	PublicID string `json:"publicId"`
	Username string `json:"username"`
	FullName string `json:"fullName"`
}

type CommunityChatMemberPresenceStatus struct {
	PublicID    string `json:"publicId"`
	Username    string `json:"username"`
	FullName    string `json:"fullName"`
	IsOnline    bool   `json:"isOnline"`
	LastSeenAt  string `json:"lastSeenAt"`
	HasPresence bool   `json:"hasPresence"`
}

type CommunityChatReactionMember struct {
	PublicID  string `json:"publicId"`
	Username  string `json:"username"`
	FullName  string `json:"fullName"`
	Reaction  string `json:"reaction"`
	CreatedAt string `json:"createdAt"`
}

type CommunityChatMentionNotification struct {
	ID             int64  `json:"id"`
	MessageID      int64  `json:"messageId"`
	SenderPublicID string `json:"senderPublicId"`
	SenderUsername string `json:"senderUsername"`
	SenderFullName string `json:"senderFullName"`
	MessageBody    string `json:"messageBody"`
	CreatedAt      string `json:"createdAt"`
}

// CommunityChatReactionMemberForViewer is the public, privacy-safe reaction roster.
// IsSelf is computed on the server for the authenticated viewer, so the browser
// never has to guess whether a reactor is the current account.
type CommunityChatReactionMemberForViewer struct {
	PublicID  string `json:"publicId"`
	Username  string `json:"username"`
	FullName  string `json:"fullName"`
	Reaction  string `json:"reaction"`
	CreatedAt string `json:"createdAt"`
	IsSelf    bool   `json:"isSelf"`
}

// EnsureCommunityChatSocialSchema creates additive presence and mention tables.
// It migrates old presence rows to a numeric epoch timestamp; message and reaction
// history is not dropped or rewritten by this migration.
func EnsureCommunityChatSocialSchema() error {
	if DB == nil {
		return fmt.Errorf("community chat social schema: database is not initialized")
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS community_chat_presence (
			user_id INTEGER NOT NULL,
			client_id TEXT NOT NULL,
			last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_epoch INTEGER NOT NULL DEFAULT 0,
			is_online INTEGER NOT NULL DEFAULT 1 CHECK (is_online IN (0,1)),
			PRIMARY KEY(user_id, client_id),
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS community_chat_mentions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			mentioned_user_id INTEGER NOT NULL,
			sender_user_id INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			read_at TEXT,
			UNIQUE(message_id, mentioned_user_id),
			FOREIGN KEY(message_id) REFERENCES community_chat_messages(id) ON DELETE CASCADE,
			FOREIGN KEY(mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_community_chat_mentions_unread ON community_chat_mentions(mentioned_user_id, read_at, id DESC);`,
	}
	for _, statement := range statements {
		if _, err := DB.Exec(statement); err != nil {
			return fmt.Errorf("prepare community chat social schema: %w", err)
		}
	}
	if err := ensureCommunityChatPresenceEpochColumn(); err != nil {
		return err
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_community_chat_presence_last_seen_epoch ON community_chat_presence(last_seen_epoch DESC)`); err != nil {
		return fmt.Errorf("create community chat presence epoch index: %w", err)
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_community_chat_presence_last_seen ON community_chat_presence(last_seen_at DESC)`); err != nil {
		return fmt.Errorf("create community chat presence timestamp index: %w", err)
	}
	return nil
}

// ensureCommunityChatPresenceEpochColumn upgrades databases created by earlier
// releases without changing existing presence history. Invalid legacy timestamps
// become zero and are not counted as active until the next heartbeat repairs them.
func ensureCommunityChatPresenceEpochColumn() error {
	rows, err := DB.Query(`PRAGMA table_info(community_chat_presence)`)
	if err != nil {
		return fmt.Errorf("inspect community chat presence columns: %w", err)
	}
	hasEpoch := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read community chat presence columns: %w", err)
		}
		if name == "last_seen_epoch" {
			hasEpoch = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate community chat presence columns: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close community chat presence columns: %w", err)
	}
	if !hasEpoch {
		if _, err := DB.Exec(`ALTER TABLE community_chat_presence ADD COLUMN last_seen_epoch INTEGER NOT NULL DEFAULT 0`); err != nil {
			return fmt.Errorf("add community chat presence epoch column: %w", err)
		}
	}
	if _, err := DB.Exec(`UPDATE community_chat_presence
		SET last_seen_epoch = COALESCE(CAST(strftime('%s', last_seen_at) AS INTEGER), 0)
		WHERE last_seen_epoch = 0`); err != nil {
		return fmt.Errorf("backfill community chat presence timestamps: %w", err)
	}
	return nil
}

func TouchCommunityChatPresence(userID int64, clientID string) error {
	if DB == nil || userID <= 0 || !validChatPresenceClientID(clientID) {
		return fmt.Errorf("invalid chat presence identity")
	}
	now := time.Now().UTC()
	lastSeenAt := now.Format("2006-01-02 15:04:05")
	lastSeenEpoch := now.Unix()
	_, err := DB.Exec(`INSERT INTO community_chat_presence(user_id,client_id,last_seen_at,last_seen_epoch,is_online)
		VALUES(?,?,?,?,1)
		ON CONFLICT(user_id,client_id) DO UPDATE SET
			last_seen_at=excluded.last_seen_at,
			last_seen_epoch=excluded.last_seen_epoch,
			is_online=1`, userID, clientID, lastSeenAt, lastSeenEpoch)
	if err != nil {
		return fmt.Errorf("update community chat presence: %w", err)
	}
	// Bound the table even if a browser exits without firing pagehide.
	_, _ = DB.Exec(`DELETE FROM community_chat_presence WHERE last_seen_epoch < ?`, now.Unix()-7*24*60*60)
	return nil
}

func LeaveCommunityChatPresence(userID int64, clientID string) error {
	if DB == nil || userID <= 0 || !validChatPresenceClientID(clientID) {
		return fmt.Errorf("invalid chat presence identity")
	}
	now := time.Now().UTC()
	_, err := DB.Exec(`UPDATE community_chat_presence
		SET is_online=0,last_seen_at=?,last_seen_epoch=?
		WHERE user_id=? AND client_id=?`, now.Format("2006-01-02 15:04:05"), now.Unix(), userID, clientID)
	if err != nil {
		return fmt.Errorf("close community chat presence: %w", err)
	}
	return nil
}

func validChatPresenceClientID(clientID string) bool {
	if len(clientID) != 32 {
		return false
	}
	for _, r := range clientID {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

// CountOnlineCommunityChatMembers counts distinct people, not tabs. Integer Unix
// timestamps avoid relying on SQLite's parsing of formatted timestamp strings.
func CountOnlineCommunityChatMembers() (int64, error) {
	if DB == nil {
		return 0, fmt.Errorf("database is not initialized")
	}
	var count int64
	cutoff := time.Now().Unix() - 90
	err := DB.QueryRow(`SELECT COUNT(DISTINCT user_id)
		FROM community_chat_presence
		WHERE is_online=1 AND last_seen_epoch >= ?`, cutoff).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count online community chat members: %w", err)
	}
	return count, nil
}

// ListCommunityChatPresence returns members active in the last 24 hours. IsOnline
// is true if any browser tab sent a heartbeat within the last 90 seconds.
func ListCommunityChatPresence(limit int) ([]CommunityChatPresence, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not initialized")
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	now := time.Now().Unix()
	cutoffOnline := now - 90
	cutoffRecent := now - 24*60*60
	rows, err := DB.Query(`
		SELECT u.public_id, COALESCE(u.username,''), u.full_name,
			COALESCE(MAX(p.last_seen_at),''),
			MAX(CASE WHEN p.is_online=1 AND p.last_seen_epoch >= ? THEN 1 ELSE 0 END)
		FROM community_chat_presence p
		JOIN users u ON u.id=p.user_id
		WHERE p.last_seen_epoch >= ?
		GROUP BY u.id,u.public_id,u.username,u.full_name
		ORDER BY MAX(CASE WHEN p.is_online=1 AND p.last_seen_epoch >= ? THEN 1 ELSE 0 END) DESC,
			MAX(p.last_seen_epoch) DESC
		LIMIT ?`, cutoffOnline, cutoffRecent, cutoffOnline, limit)
	if err != nil {
		return nil, fmt.Errorf("list community chat presence: %w", err)
	}
	defer rows.Close()
	members := make([]CommunityChatPresence, 0, limit)
	for rows.Next() {
		var member CommunityChatPresence
		var online int
		if err := rows.Scan(&member.PublicID, &member.Username, &member.FullName, &member.LastSeenAt, &online); err != nil {
			return nil, fmt.Errorf("scan community chat presence: %w", err)
		}
		member.IsOnline = online != 0
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate community chat presence: %w", err)
	}
	return members, nil
}

func SearchCommunityChatMentionMembers(viewerID int64, query string, limit int) ([]CommunityChatMentionMember, error) {
	if DB == nil || viewerID <= 0 {
		return nil, fmt.Errorf("invalid database or viewer")
	}
	query = strings.TrimSpace(query)
	if len([]rune(query)) > 80 {
		query = string([]rune(query)[:80])
	}
	if limit < 1 || limit > 12 {
		limit = 8
	}
	rows, err := DB.Query(`SELECT public_id, COALESCE(username,''), full_name FROM users
        WHERE id <> ? AND (? = '' OR instr(lower(COALESCE(username,'')),lower(?))>0 OR instr(lower(full_name),lower(?))>0)
        ORDER BY CASE WHEN ? = '' THEN 0 WHEN lower(COALESCE(username,''))=lower(?) THEN 0 WHEN lower(full_name)=lower(?) THEN 1 ELSE 2 END,
                 lower(COALESCE(username,'')), lower(full_name), id LIMIT ?`,
		viewerID, query, query, query, query, query, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search chat mention members: %w", err)
	}
	defer rows.Close()
	members := make([]CommunityChatMentionMember, 0, limit)
	for rows.Next() {
		var member CommunityChatMentionMember
		if err := rows.Scan(&member.PublicID, &member.Username, &member.FullName); err != nil {
			return nil, err
		}
		if strings.TrimSpace(member.Username) == "" {
			continue
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return members, nil
}

// GetCommunityChatMentionMemberByUsername performs an exact, case-insensitive
// lookup so a rendered @username link can never open a fuzzy search result.
func GetCommunityChatMentionMemberByUsername(username string) (CommunityChatMentionMember, error) {
	if DB == nil {
		return CommunityChatMentionMember{}, fmt.Errorf("database is not initialized")
	}
	username = strings.TrimSpace(strings.TrimPrefix(username, "@"))
	if username == "" || len([]rune(username)) > 80 {
		return CommunityChatMentionMember{}, fmt.Errorf("invalid username")
	}
	var member CommunityChatMentionMember
	err := DB.QueryRow(`SELECT public_id, COALESCE(username,''), full_name
		FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`, username).
		Scan(&member.PublicID, &member.Username, &member.FullName)
	if err != nil {
		return CommunityChatMentionMember{}, err
	}
	return member, nil
}

// ListCommunityChatReactionMembers returns public identities behind a message's
// reactions. It intentionally excludes email and internal database user IDs.
func ListCommunityChatReactionMembers(messageID int64, limit int) ([]CommunityChatReactionMember, error) {
	if DB == nil || messageID <= 0 {
		return nil, fmt.Errorf("invalid message or database")
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	var exists int
	if err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM community_chat_messages WHERE id=? AND deleted_at IS NULL)`, messageID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check reaction target message: %w", err)
	}
	if exists == 0 {
		return nil, fmt.Errorf("message not found")
	}
	rows, err := DB.Query(`
		SELECT u.public_id, COALESCE(u.username,''), u.full_name, r.reaction, CAST(r.created_at AS TEXT)
		FROM community_chat_reactions r
		JOIN users u ON u.id=r.user_id
		WHERE r.message_id=?
		ORDER BY r.created_at DESC, u.id ASC
		LIMIT ?`, messageID, limit)
	if err != nil {
		return nil, fmt.Errorf("list reaction members: %w", err)
	}
	defer rows.Close()
	members := make([]CommunityChatReactionMember, 0, limit)
	for rows.Next() {
		var member CommunityChatReactionMember
		if err := rows.Scan(&member.PublicID, &member.Username, &member.FullName, &member.Reaction, &member.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan reaction member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reaction members: %w", err)
	}
	return members, nil
}

// GetCommunityChatMemberPresenceStatus reads presence for a public profile.
func GetCommunityChatMemberPresenceStatus(publicID string) (CommunityChatMemberPresenceStatus, error) {
	if DB == nil {
		return CommunityChatMemberPresenceStatus{}, fmt.Errorf("database is not initialized")
	}
	publicID = strings.TrimSpace(publicID)
	if publicID == "" || len(publicID) > 64 {
		return CommunityChatMemberPresenceStatus{}, fmt.Errorf("invalid public member ID")
	}
	var status CommunityChatMemberPresenceStatus
	var online int
	var lastSeenEpoch int64
	err := DB.QueryRow(`
		SELECT u.public_id, COALESCE(u.username,''), u.full_name,
			COALESCE(MAX(p.last_seen_at),''),
			MAX(CASE WHEN p.is_online=1 AND p.last_seen_epoch >= ? THEN 1 ELSE 0 END),
			COALESCE(MAX(p.last_seen_epoch),0)
		FROM users u LEFT JOIN community_chat_presence p ON p.user_id=u.id
		WHERE u.public_id = ? COLLATE NOCASE
		GROUP BY u.id,u.public_id,u.username,u.full_name`, time.Now().Unix()-90, publicID).
		Scan(&status.PublicID, &status.Username, &status.FullName, &status.LastSeenAt, &online, &lastSeenEpoch)
	if err != nil {
		return CommunityChatMemberPresenceStatus{}, err
	}
	status.IsOnline = online != 0
	status.HasPresence = lastSeenEpoch > 0
	return status, nil
}

// GetCommunityChatPresenceForUserID returns the authenticated viewer's public
// identity plus presence state. It lets the roster defensively include the viewer
// after a successful heartbeat, even if the paginated roster changes concurrently.
func GetCommunityChatPresenceForUserID(userID int64) (CommunityChatPresence, error) {
	if DB == nil || userID <= 0 {
		return CommunityChatPresence{}, fmt.Errorf("invalid database or user")
	}
	var member CommunityChatPresence
	var online int
	err := DB.QueryRow(`
		SELECT u.public_id, COALESCE(u.username,''), u.full_name,
			COALESCE(MAX(p.last_seen_at),''),
			MAX(CASE WHEN p.is_online=1 AND p.last_seen_epoch >= ? THEN 1 ELSE 0 END)
		FROM users u LEFT JOIN community_chat_presence p ON p.user_id=u.id
		WHERE u.id=?
		GROUP BY u.id,u.public_id,u.username,u.full_name`, time.Now().Unix()-90, userID).
		Scan(&member.PublicID, &member.Username, &member.FullName, &member.LastSeenAt, &online)
	if err != nil {
		return CommunityChatPresence{}, fmt.Errorf("get own community chat presence: %w", err)
	}
	member.IsOnline = online != 0
	return member, nil
}

type chatMentionCandidate struct {
	id       int64
	username string
	fullName string
}

// CreateCommunityChatMentionNotifications resolves exact @username tokens.
// Autocomplete may search by a full name, but the chosen mention is always the
// unique username handle, so notification delivery is deterministic.
func CreateCommunityChatMentionNotifications(messageID, senderID int64, body string) error {
	if DB == nil || messageID <= 0 || senderID <= 0 {
		return fmt.Errorf("invalid chat mention identity")
	}
	rows, err := DB.Query(`SELECT id,COALESCE(username,''),full_name FROM users WHERE id<>?`, senderID)
	if err != nil {
		return fmt.Errorf("load mention candidates: %w", err)
	}
	candidates := make([]chatMentionCandidate, 0)
	for rows.Next() {
		var candidate chatMentionCandidate
		if err := rows.Scan(&candidate.id, &candidate.username, &candidate.fullName); err != nil {
			_ = rows.Close()
			return err
		}
		if strings.TrimSpace(candidate.username) != "" || strings.TrimSpace(candidate.fullName) != "" {
			candidates = append(candidates, candidate)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	// Longest handles are checked first and token-boundaries prevent a short
	// handle from matching the beginning of a different username.
	sort.Slice(candidates, func(i, j int) bool {
		return len([]rune(candidates[i].username)) > len([]rune(candidates[j].username))
	})
	bodyRunes := []rune(strings.ToLower(body))
	mentioned := make(map[int64]struct{})
	isTokenRune := func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' }
	for at, current := range bodyRunes {
		if current != '@' {
			continue
		}
		if at > 0 {
			prev := bodyRunes[at-1]
			if isTokenRune(prev) || prev == '.' || prev == '+' || prev == '-' {
				continue
			}
		}
		for _, candidate := range candidates {
			name := []rune(strings.ToLower(strings.TrimSpace(candidate.username)))
			if len(name) == 0 || at+1+len(name) > len(bodyRunes) {
				continue
			}
			if string(bodyRunes[at+1:at+1+len(name)]) != string(name) {
				continue
			}
			end := at + 1 + len(name)
			if end < len(bodyRunes) && isTokenRune(bodyRunes[end]) {
				continue
			}
			mentioned[candidate.id] = struct{}{}
			break
		}
	}

	// Reconcile this message's mention targets in one transaction. Keep rows for
	// users who remain mentioned, preserving their read state and notification ID;
	// delete only people whose handles were removed, and insert only newly added
	// targets. This prevents an ordinary edit from re-notifying the same members.
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err = tx.Query(`SELECT mentioned_user_id FROM community_chat_mentions WHERE message_id=?`, messageID)
	if err != nil {
		return fmt.Errorf("read existing chat mention targets: %w", err)
	}
	existing := make(map[int64]struct{})
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			_ = rows.Close()
			return err
		}
		existing[userID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for userID := range existing {
		if _, stillMentioned := mentioned[userID]; stillMentioned {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM community_chat_mentions WHERE message_id=? AND mentioned_user_id=?`, messageID, userID); err != nil {
			return fmt.Errorf("remove stale chat mention target: %w", err)
		}
	}
	for userID := range mentioned {
		if _, alreadyMentioned := existing[userID]; alreadyMentioned {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO community_chat_mentions(message_id,mentioned_user_id,sender_user_id) VALUES(?,?,?)`, messageID, userID, senderID); err != nil {
			return fmt.Errorf("save chat mention: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func ListUnreadCommunityChatMentions(userID int64, limit int) ([]CommunityChatMentionNotification, int64, error) {
	if DB == nil || userID <= 0 {
		return nil, 0, fmt.Errorf("invalid database or user")
	}
	if limit < 1 || limit > 50 {
		limit = 30
	}
	var count int64
	if err := DB.QueryRow(`SELECT COUNT(*) FROM community_chat_mentions WHERE mentioned_user_id=? AND read_at IS NULL`, userID).Scan(&count); err != nil {
		return nil, 0, err
	}
	rows, err := DB.Query(`SELECT cm.id,cm.message_id,s.public_id,COALESCE(s.username,''),s.full_name,
        CASE WHEN m.deleted_at IS NOT NULL THEN 'This message was deleted' ELSE m.body END,CAST(cm.created_at AS TEXT)
        FROM community_chat_mentions cm JOIN users s ON s.id=cm.sender_user_id
        JOIN community_chat_messages m ON m.id=cm.message_id
        WHERE cm.mentioned_user_id=? AND cm.read_at IS NULL ORDER BY cm.id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("list chat mentions: %w", err)
	}
	defer rows.Close()
	items := make([]CommunityChatMentionNotification, 0, limit)
	for rows.Next() {
		var item CommunityChatMentionNotification
		if err := rows.Scan(&item.ID, &item.MessageID, &item.SenderPublicID, &item.SenderUsername, &item.SenderFullName, &item.MessageBody, &item.CreatedAt); err != nil {
			return nil, 0, err
		}
		if len([]rune(item.MessageBody)) > 180 {
			item.MessageBody = string([]rune(item.MessageBody)[:180]) + "…"
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, count, nil
}

func MarkCommunityChatMentionRead(userID, mentionID int64) error {
	if DB == nil || userID <= 0 || mentionID <= 0 {
		return fmt.Errorf("invalid mention identity")
	}
	_, err := DB.Exec(`UPDATE community_chat_mentions SET read_at=CURRENT_TIMESTAMP WHERE id=? AND mentioned_user_id=? AND read_at IS NULL`, mentionID, userID)
	if err != nil {
		return fmt.Errorf("mark chat mention read: %w", err)
	}
	return nil
}

// ListCommunityChatReactionMembersForViewer returns the most recent reactors
// for one active chat message, marking the authenticated viewer's own reaction.
// It deliberately does not expose internal numeric user IDs or email addresses.
func ListCommunityChatReactionMembersForViewer(messageID, viewerID int64, limit int) ([]CommunityChatReactionMemberForViewer, error) {
	if DB == nil || messageID <= 0 || viewerID <= 0 {
		return nil, fmt.Errorf("invalid message, viewer, or database")
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}

	var exists int
	if err := DB.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM community_chat_messages WHERE id=? AND deleted_at IS NULL)`,
		messageID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check reaction target message: %w", err)
	}
	if exists == 0 {
		return nil, fmt.Errorf("message not found")
	}

	rows, err := DB.Query(`
		SELECT u.public_id,
		       COALESCE(u.username, ''),
		       u.full_name,
		       r.reaction,
		       CAST(r.created_at AS TEXT),
		       CASE WHEN r.user_id = ? THEN 1 ELSE 0 END
		FROM community_chat_reactions AS r
		JOIN users AS u ON u.id = r.user_id
		WHERE r.message_id = ?
		ORDER BY r.created_at DESC, u.id ASC
		LIMIT ?`, viewerID, messageID, limit)
	if err != nil {
		return nil, fmt.Errorf("list reaction members for viewer: %w", err)
	}
	defer rows.Close()

	members := make([]CommunityChatReactionMemberForViewer, 0, limit)
	for rows.Next() {
		var member CommunityChatReactionMemberForViewer
		var isSelf int
		if err := rows.Scan(
			&member.PublicID,
			&member.Username,
			&member.FullName,
			&member.Reaction,
			&member.CreatedAt,
			&isSelf,
		); err != nil {
			return nil, fmt.Errorf("scan reaction member: %w", err)
		}
		member.IsSelf = isSelf == 1
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reaction members: %w", err)
	}
	return members, nil
}
