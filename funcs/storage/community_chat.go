package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// CommunityChatMessage is the database-facing representation of a room message.
// Numeric sender IDs are internal and must never be serialized to the browser.
type CommunityChatMessage struct {
	ID               int64
	SenderID         int64
	SenderPublicID   string
	SenderUsername   string
	SenderFullName   string
	Body             string
	Kind             string
	AttachmentURL    string
	AttachmentMIME   string
	AttachmentName   string
	AttachmentSize   int64
	MovieID          int64
	MovieTitle       string
	MoviePosterURL   string
	MovieOverview    string
	MovieReleaseDate string
	ReplyToID        int64
	CreatedAt        string
	EditedAt         string
	DeletedAt        string
	ReplyTo          *CommunityChatReply
	ReactionCounts   map[string]int64
	MyReaction       string
}

type CommunityChatReply struct {
	ID             int64
	SenderPublicID string
	SenderUsername string
	SenderFullName string
	Body           string
	Kind           string
	Deleted        bool
}

type CommunityChatMessageInput struct {
	Body             string
	Kind             string
	AttachmentURL    string
	AttachmentMIME   string
	AttachmentName   string
	AttachmentSize   int64
	MovieID          int64
	MovieTitle       string
	MoviePosterURL   string
	MovieOverview    string
	MovieReleaseDate string
	ReplyToID        int64
}

var communityChatReactionKinds = map[string]struct{}{
	"like": {}, "love": {}, "dislike": {}, "fire": {}, "laugh": {}, "cry": {}, "wow": {}, "angry": {}, "awful": {},
}

// EnsureCommunityChatSchema creates the durable global-room message/reaction tables.
// Call once during startup after the users table exists and before the server listens.
func EnsureCommunityChatSchema() error {
	if DB == nil {
		return fmt.Errorf("community chat schema: database is not initialized")
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS community_chat_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sender_user_id INTEGER NOT NULL,
			body TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','video','voice','movie','deleted')),
			attachment_url TEXT NOT NULL DEFAULT '',
			attachment_mime TEXT NOT NULL DEFAULT '',
			attachment_name TEXT NOT NULL DEFAULT '',
			attachment_size INTEGER NOT NULL DEFAULT 0,
			movie_id INTEGER NOT NULL DEFAULT 0,
			movie_title TEXT NOT NULL DEFAULT '',
			movie_poster_url TEXT NOT NULL DEFAULT '',
			movie_overview TEXT NOT NULL DEFAULT '',
			movie_release_date TEXT NOT NULL DEFAULT '',
			reply_to_id INTEGER,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			edited_at TEXT,
			deleted_at TEXT,
			FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY(reply_to_id) REFERENCES community_chat_messages(id) ON DELETE SET NULL,
			CHECK(length(body) <= 3000)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_community_chat_messages_created ON community_chat_messages(id DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_community_chat_messages_sender ON community_chat_messages(sender_user_id, id DESC);`,
		`CREATE TABLE IF NOT EXISTS community_chat_reactions (
			message_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			reaction TEXT NOT NULL CHECK (reaction IN ('like','love','dislike','fire','laugh','cry','wow','angry','awful')),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY(message_id, user_id),
			FOREIGN KEY(message_id) REFERENCES community_chat_messages(id) ON DELETE CASCADE,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_community_chat_reactions_message ON community_chat_reactions(message_id);`,
	}
	for _, statement := range statements {
		if _, err := DB.Exec(statement); err != nil {
			return fmt.Errorf("prepare community chat schema: %w", err)
		}
	}
	if err := migrateCommunityChatReactionSchema(); err != nil {
		return fmt.Errorf("migrate community chat reactions: %w", err)
	}
	return nil
}

// migrateCommunityChatReactionSchema expands the SQLite CHECK constraint for
// existing installs without losing their saved reactions. Fresh databases
// already have the expanded constraint, so this is a no-op there.
func migrateCommunityChatReactionSchema() error {
	var currentSchema sql.NullString
	if err := DB.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'community_chat_reactions'`).Scan(&currentSchema); err != nil {
		return err
	}
	schema := strings.ToLower(currentSchema.String)
	if strings.Contains(schema, "'laugh'") && strings.Contains(schema, "'cry'") && strings.Contains(schema, "'wow'") {
		return nil
	}

	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`ALTER TABLE community_chat_reactions RENAME TO community_chat_reactions_legacy`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE TABLE community_chat_reactions (
		message_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		reaction TEXT NOT NULL CHECK (reaction IN ('like','love','dislike','fire','laugh','cry','wow','angry','awful')),
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(message_id, user_id),
		FOREIGN KEY(message_id) REFERENCES community_chat_messages(id) ON DELETE CASCADE,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO community_chat_reactions(message_id, user_id, reaction, created_at)
		SELECT message_id, user_id, reaction, created_at FROM community_chat_reactions_legacy
		WHERE reaction IN ('like','love','dislike','fire','angry','awful')`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE community_chat_reactions_legacy`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_community_chat_reactions_message ON community_chat_reactions(message_id)`); err != nil {
		return err
	}
	return tx.Commit()
}

// ListCommunityChatMessages returns the newest window when both cursors are zero,
// newer messages when afterID > 0, or an older window when beforeID > 0.
func ListCommunityChatMessages(viewerID, afterID, beforeID int64, limit int) ([]CommunityChatMessage, error) {
	if DB == nil || viewerID <= 0 {
		return nil, fmt.Errorf("invalid database or viewer ID")
	}
	if limit < 1 || limit > 100 {
		limit = 60
	}
	where := ""
	order := "DESC"
	args := []any{}
	switch {
	case afterID > 0:
		where, order = "WHERE m.id > ?", "ASC"
		args = append(args, afterID)
	case beforeID > 0:
		where, order = "WHERE m.id < ?", "DESC"
		args = append(args, beforeID)
	}
	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT
			m.id, m.sender_user_id, u.public_id, COALESCE(u.username,''), u.full_name,
			m.body, m.kind, m.attachment_url, m.attachment_mime, m.attachment_name,
			m.attachment_size, m.movie_id, m.movie_title, m.movie_poster_url,
			m.movie_overview, m.movie_release_date, COALESCE(m.reply_to_id, 0),
			CAST(m.created_at AS TEXT), COALESCE(CAST(m.edited_at AS TEXT), ''),
			COALESCE(CAST(m.deleted_at AS TEXT), ''),
			COALESCE(p.id, 0), COALESCE(pu.public_id, ''), COALESCE(pu.username, ''),
			COALESCE(pu.full_name, ''), COALESCE(p.body, ''), COALESCE(p.kind, ''),
			COALESCE(CAST(p.deleted_at AS TEXT), '')
		FROM community_chat_messages m
		JOIN users u ON u.id = m.sender_user_id
		LEFT JOIN community_chat_messages p ON p.id = m.reply_to_id
		LEFT JOIN users pu ON pu.id = p.sender_user_id
		%s
		ORDER BY m.id %s
		LIMIT ?`, where, order)
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query community chat messages: %w", err)
	}
	messages := make([]CommunityChatMessage, 0, limit)
	for rows.Next() {
		var m CommunityChatMessage
		var parentID int64
		var parentPublicID, parentUsername, parentName, parentBody, parentKind, parentDeleted string
		if err := rows.Scan(
			&m.ID, &m.SenderID, &m.SenderPublicID, &m.SenderUsername, &m.SenderFullName,
			&m.Body, &m.Kind, &m.AttachmentURL, &m.AttachmentMIME, &m.AttachmentName,
			&m.AttachmentSize, &m.MovieID, &m.MovieTitle, &m.MoviePosterURL, &m.MovieOverview,
			&m.MovieReleaseDate, &m.ReplyToID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt,
			&parentID, &parentPublicID, &parentUsername, &parentName, &parentBody, &parentKind, &parentDeleted,
		); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan community chat message: %w", err)
		}
		if parentID > 0 {
			m.ReplyTo = &CommunityChatReply{ID: parentID, SenderPublicID: parentPublicID, SenderUsername: parentUsername, SenderFullName: parentName, Body: parentBody, Kind: parentKind, Deleted: parentDeleted != ""}
			if m.ReplyTo.Deleted {
				m.ReplyTo.Body = "This message was deleted"
			}
		}
		if m.DeletedAt != "" {
			m.Body = ""
			m.Kind = "deleted"
			m.AttachmentURL, m.AttachmentMIME, m.AttachmentName = "", "", ""
			m.AttachmentSize, m.MovieID = 0, 0
			m.MovieTitle, m.MoviePosterURL, m.MovieOverview, m.MovieReleaseDate = "", "", "", ""
		}
		m.ReactionCounts = make(map[string]int64)
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate community chat messages: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// beforeID queries are descending to select the nearest older window; render in chronological order.
	if beforeID > 0 || (afterID == 0 && beforeID == 0) {
		for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
			messages[left], messages[right] = messages[right], messages[left]
		}
	}
	if len(messages) == 0 {
		return messages, nil
	}

	placeholders := make([]string, len(messages))
	reactionArgs := []any{viewerID}
	for i, m := range messages {
		placeholders[i] = "?"
		reactionArgs = append(reactionArgs, m.ID)
	}
	reactionQuery := `SELECT message_id, reaction, COUNT(*), MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END)
		FROM community_chat_reactions WHERE message_id IN (` + strings.Join(placeholders, ",") + `) GROUP BY message_id, reaction`
	reactionRows, err := DB.Query(reactionQuery, reactionArgs...)
	if err != nil {
		return nil, fmt.Errorf("query community chat reactions: %w", err)
	}
	byID := make(map[int64]*CommunityChatMessage, len(messages))
	for i := range messages {
		byID[messages[i].ID] = &messages[i]
	}
	for reactionRows.Next() {
		var messageID int64
		var reaction string
		var count int64
		var mine int
		if err := reactionRows.Scan(&messageID, &reaction, &count, &mine); err != nil {
			_ = reactionRows.Close()
			return nil, fmt.Errorf("scan community chat reaction: %w", err)
		}
		if message := byID[messageID]; message != nil {
			message.ReactionCounts[reaction] = count
			if mine != 0 {
				message.MyReaction = reaction
			}
		}
	}
	if err := reactionRows.Err(); err != nil {
		_ = reactionRows.Close()
		return nil, fmt.Errorf("iterate community chat reactions: %w", err)
	}
	if err := reactionRows.Close(); err != nil {
		return nil, err
	}
	return messages, nil
}

// GetCommunityChatMessage returns one message with reaction aggregates.
func GetCommunityChatMessage(viewerID, messageID int64) (CommunityChatMessage, error) {
	if messageID <= 0 {
		return CommunityChatMessage{}, sql.ErrNoRows
	}
	messages, err := ListCommunityChatMessages(viewerID, 0, messageID+1, 100)
	if err != nil {
		return CommunityChatMessage{}, err
	}
	for _, message := range messages {
		if message.ID == messageID {
			return message, nil
		}
	}
	return CommunityChatMessage{}, sql.ErrNoRows
}

// CreateCommunityChatMessage writes one durable room message.
func CreateCommunityChatMessage(senderID int64, input CommunityChatMessageInput) (CommunityChatMessage, error) {
	if DB == nil || senderID <= 0 {
		return CommunityChatMessage{}, fmt.Errorf("invalid database or sender ID")
	}
	if input.ReplyToID > 0 {
		var exists int
		err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM community_chat_messages WHERE id = ? AND deleted_at IS NULL)`, input.ReplyToID).Scan(&exists)
		if err != nil {
			return CommunityChatMessage{}, fmt.Errorf("validate reply target: %w", err)
		}
		if exists == 0 {
			return CommunityChatMessage{}, sql.ErrNoRows
		}
	}
	result, err := DB.Exec(`
		INSERT INTO community_chat_messages (
			sender_user_id, body, kind, attachment_url, attachment_mime, attachment_name,
			attachment_size, movie_id, movie_title, movie_poster_url, movie_overview,
			movie_release_date, reply_to_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0))`,
		senderID, input.Body, input.Kind, input.AttachmentURL, input.AttachmentMIME, input.AttachmentName,
		input.AttachmentSize, input.MovieID, input.MovieTitle, input.MoviePosterURL, input.MovieOverview,
		input.MovieReleaseDate, input.ReplyToID,
	)
	if err != nil {
		return CommunityChatMessage{}, fmt.Errorf("insert community chat message: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return CommunityChatMessage{}, fmt.Errorf("read community chat message ID: %w", err)
	}
	return GetCommunityChatMessage(senderID, id)
}

// EditCommunityChatMessage allows only the author to edit an undeleted text message.
func EditCommunityChatMessage(senderID, messageID int64, body string) (CommunityChatMessage, error) {
	if DB == nil || senderID <= 0 || messageID <= 0 {
		return CommunityChatMessage{}, fmt.Errorf("invalid database, sender or message ID")
	}
	result, err := DB.Exec(`UPDATE community_chat_messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND sender_user_id = ? AND kind = 'text' AND deleted_at IS NULL`, body, messageID, senderID)
	if err != nil {
		return CommunityChatMessage{}, fmt.Errorf("edit community chat message: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return CommunityChatMessage{}, err
	}
	if affected == 0 {
		return CommunityChatMessage{}, sql.ErrNoRows
	}
	return GetCommunityChatMessage(senderID, messageID)
}

// DeleteCommunityChatMessage soft-deletes an author's message and removes its reactions.
func DeleteCommunityChatMessage(senderID, messageID int64) error {
	if DB == nil || senderID <= 0 || messageID <= 0 {
		return fmt.Errorf("invalid database, sender or message ID")
	}
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE community_chat_messages SET body = '', kind = 'deleted', attachment_url = '', attachment_mime = '', attachment_name = '', attachment_size = 0, movie_id = 0, movie_title = '', movie_poster_url = '', movie_overview = '', movie_release_date = '', deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL`, messageID, senderID)
	if err != nil {
		return fmt.Errorf("delete community chat message: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	if _, err := tx.Exec(`DELETE FROM community_chat_reactions WHERE message_id = ?`, messageID); err != nil {
		return fmt.Errorf("remove reactions for deleted chat message: %w", err)
	}
	return tx.Commit()
}

// SetCommunityChatReaction stores one reaction per member/message. Selecting the
// same reaction twice removes it; choosing another reaction replaces the old one.
func SetCommunityChatReaction(userID, messageID int64, reaction string) (CommunityChatMessage, error) {
	if DB == nil || userID <= 0 || messageID <= 0 {
		return CommunityChatMessage{}, fmt.Errorf("invalid database, user or message ID")
	}
	reaction = strings.ToLower(strings.TrimSpace(reaction))
	if _, ok := communityChatReactionKinds[reaction]; !ok {
		return CommunityChatMessage{}, fmt.Errorf("unsupported reaction")
	}
	var active int
	if err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM community_chat_messages WHERE id = ? AND deleted_at IS NULL)`, messageID).Scan(&active); err != nil {
		return CommunityChatMessage{}, err
	}
	if active == 0 {
		return CommunityChatMessage{}, sql.ErrNoRows
	}
	var current string
	err := DB.QueryRow(`SELECT reaction FROM community_chat_reactions WHERE message_id = ? AND user_id = ?`, messageID, userID).Scan(&current)
	switch {
	case err == nil && current == reaction:
		if _, err := DB.Exec(`DELETE FROM community_chat_reactions WHERE message_id = ? AND user_id = ?`, messageID, userID); err != nil {
			return CommunityChatMessage{}, fmt.Errorf("remove chat reaction: %w", err)
		}
	case errors.Is(err, sql.ErrNoRows):
		if _, err := DB.Exec(`INSERT INTO community_chat_reactions(message_id, user_id, reaction) VALUES (?, ?, ?)`, messageID, userID, reaction); err != nil {
			return CommunityChatMessage{}, fmt.Errorf("add chat reaction: %w", err)
		}
	case err != nil:
		return CommunityChatMessage{}, err
	default:
		if _, err := DB.Exec(`UPDATE community_chat_reactions SET reaction = ?, created_at = CURRENT_TIMESTAMP WHERE message_id = ? AND user_id = ?`, reaction, messageID, userID); err != nil {
			return CommunityChatMessage{}, fmt.Errorf("change chat reaction: %w", err)
		}
	}
	return GetCommunityChatMessage(userID, messageID)
}
