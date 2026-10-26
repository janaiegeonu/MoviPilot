package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// CollectionHubFolder represents a folder owned by the signed-in member. The
// same movipilot_collections table is used by the existing Explore collection
// picker, so folders created on either surface remain in sync.
type CollectionHubFolder struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ItemCount int    `json:"itemCount"`
	CreatedAt string `json:"createdAt"`
}

// CollectionHubItem is a safe, public-media-only snapshot. It never contains
// user account or authentication fields.
type CollectionHubItem struct {
	ID             int64   `json:"id"`
	MediaType      string  `json:"mediaType"`
	MediaID        int64   `json:"mediaId"`
	Title          string  `json:"title"`
	Overview       string  `json:"overview"`
	PosterURL      string  `json:"posterUrl"`
	BackdropURL    string  `json:"backdropUrl"`
	Year           string  `json:"year"`
	VoteAverage    float64 `json:"voteAverage"`
	MediaTypeLabel string  `json:"mediaTypeLabel"`
	AddedAt        string  `json:"addedAt"`
}

type CollectionHubFriend struct {
	PublicID  string `json:"publicId"`
	Username  string `json:"username"`
	FullName  string `json:"fullName"`
	CreatedAt string `json:"createdAt"`
}

type CollectionHubShare struct {
	ID           int64               `json:"id"`
	CollectionID int64               `json:"-"`
	Name         string              `json:"name"`
	Message      string              `json:"message"`
	Status       string              `json:"status"`
	CreatedAt    string              `json:"createdAt"`
	RespondedAt  string              `json:"respondedAt,omitempty"`
	ItemCount    int                 `json:"itemCount"`
	Sender       CollectionHubFriend `json:"sender"`
}

var (
	collectionHubSchemaOnce sync.Once
	collectionHubSchemaErr  error
)

// EnsureExploreCommunityCollectionSchema prepares only additive sharing tables
// and a case-insensitive unique folder-name index. Existing Explore tables and
// collection item rows are retained.
func EnsureExploreCommunityCollectionSchema() error {
	if DB == nil {
		return errors.New("collection hub: database is not initialized")
	}
	collectionHubSchemaOnce.Do(func() {
		if err := EnsureExploreTables(); err != nil {
			collectionHubSchemaErr = err
			return
		}
		if err := EnsureCommunitySchema(); err != nil {
			collectionHubSchemaErr = err
			return
		}
		if err := normalizeCollectionFolderNames(); err != nil {
			collectionHubSchemaErr = err
			return
		}
		_, collectionHubSchemaErr = DB.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_collection_user_name_nocase
ON movipilot_collections(user_id, name COLLATE NOCASE);

-- The same public-media snapshot shape is used by the Personal Library feature
-- when installed; IF NOT EXISTS keeps both features compatible.
CREATE TABLE IF NOT EXISTS movipilot_media_snapshots (
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL CHECK (media_id > 0),
    title TEXT NOT NULL DEFAULT '',
    overview TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    backdrop_url TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    vote_average REAL NOT NULL DEFAULT 0,
    media_type_label TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(media_type, media_id)
);

CREATE TABLE IF NOT EXISTS movipilot_collection_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_collection_id INTEGER NOT NULL,
    sender_user_id INTEGER NOT NULL,
    recipient_user_id INTEGER NOT NULL,
    collection_name TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT,
    UNIQUE(source_collection_id, sender_user_id, recipient_user_id),
    FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK(sender_user_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_collection_shares_inbox
ON movipilot_collection_shares(recipient_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mp_collection_shares_sender
ON movipilot_collection_shares(sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_collection_share_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL CHECK (media_id > 0),
    source_added_at TEXT NOT NULL DEFAULT (datetime('now')),
    title TEXT NOT NULL DEFAULT '',
    overview TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    backdrop_url TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    vote_average REAL NOT NULL DEFAULT 0,
    media_type_label TEXT NOT NULL DEFAULT '',
    UNIQUE(share_id, media_type, media_id),
    FOREIGN KEY(share_id) REFERENCES movipilot_collection_shares(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mp_collection_share_items_share
ON movipilot_collection_share_items(share_id, source_added_at DESC);
`)
	})
	return collectionHubSchemaErr
}

// normalizeCollectionFolderNames preserves every folder and item association.
// When an older database contains names that only differ by case, it gives the
// later folder a readable numeric suffix before adding the NOCASE unique index.
func normalizeCollectionFolderNames() error {
	rows, err := DB.Query(`SELECT id, user_id, name FROM movipilot_collections ORDER BY user_id, created_at ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("read collection folder names: %w", err)
	}
	type existingFolder struct {
		id   int64
		user int64
		name string
	}
	folders := make([]existingFolder, 0)
	for rows.Next() {
		var folder existingFolder
		if err := rows.Scan(&folder.id, &folder.user, &folder.name); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan collection folder name: %w", err)
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate collection folder names: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close collection folder names: %w", err)
	}

	seen := make(map[int64]map[string]bool)
	for _, folder := range folders {
		if seen[folder.user] == nil {
			seen[folder.user] = make(map[string]bool)
		}
		base := strings.TrimSpace(folder.name)
		if base == "" {
			base = "Untitled collection"
		}
		candidate := base
		for suffix := 2; seen[folder.user][strings.ToLower(candidate)]; suffix++ {
			candidate = fmt.Sprintf("%s (%d)", base, suffix)
		}
		if candidate != folder.name {
			if _, err := DB.Exec(`UPDATE movipilot_collections SET name = ? WHERE id = ? AND user_id = ?`, candidate, folder.id, folder.user); err != nil {
				return fmt.Errorf("repair duplicate collection folder name: %w", err)
			}
		}
		seen[folder.user][strings.ToLower(candidate)] = true
	}
	return nil
}

// StoreCollectionHubMediaSnapshot caches non-user-specific movie/series metadata.
// It intentionally shares the table used by Personal Library when that feature
// is installed, but the Collection Hub can initialize the table independently.
func StoreCollectionHubMediaSnapshot(mediaType string, mediaID int64, title, overview, posterURL, backdropURL, year string, voteAverage float64, mediaTypeLabel string) error {
	if DB == nil {
		return errors.New("collection hub: database is not initialized")
	}
	if (mediaType != "movie" && mediaType != "tv") || mediaID <= 0 {
		return errors.New("invalid media identifier")
	}
	_, err := DB.Exec(`
INSERT INTO movipilot_media_snapshots(
    media_type, media_id, title, overview, poster_url, backdrop_url,
    year, vote_average, media_type_label, updated_at
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT(media_type, media_id)
DO UPDATE SET
    title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE movipilot_media_snapshots.title END,
    overview = CASE WHEN excluded.overview <> '' THEN excluded.overview ELSE movipilot_media_snapshots.overview END,
    poster_url = CASE WHEN excluded.poster_url <> '' THEN excluded.poster_url ELSE movipilot_media_snapshots.poster_url END,
    backdrop_url = CASE WHEN excluded.backdrop_url <> '' THEN excluded.backdrop_url ELSE movipilot_media_snapshots.backdrop_url END,
    year = CASE WHEN excluded.year <> '' THEN excluded.year ELSE movipilot_media_snapshots.year END,
    vote_average = CASE WHEN excluded.vote_average > 0 THEN excluded.vote_average ELSE movipilot_media_snapshots.vote_average END,
    media_type_label = CASE WHEN excluded.media_type_label <> '' THEN excluded.media_type_label ELSE movipilot_media_snapshots.media_type_label END,
    updated_at = datetime('now')
`, mediaType, mediaID, strings.TrimSpace(title), strings.TrimSpace(overview), strings.TrimSpace(posterURL), strings.TrimSpace(backdropURL), strings.TrimSpace(year), voteAverage, strings.TrimSpace(mediaTypeLabel))
	return err
}

func ListCollectionHubFolders(userID int64) ([]CollectionHubFolder, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.New("invalid user id")
	}
	rows, err := DB.Query(`
SELECT c.id, c.name, CAST(c.created_at AS TEXT), COUNT(ci.id)
FROM movipilot_collections c
LEFT JOIN movipilot_collection_items ci ON ci.collection_id = c.id
WHERE c.user_id = ?
GROUP BY c.id, c.name, c.created_at
ORDER BY c.created_at DESC, c.id DESC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := make([]CollectionHubFolder, 0)
	for rows.Next() {
		var folder CollectionHubFolder
		if err := rows.Scan(&folder.ID, &folder.Name, &folder.CreatedAt, &folder.ItemCount); err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	return folders, rows.Err()
}

func CreateCollectionHubFolder(userID int64, name string) (CollectionHubFolder, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return CollectionHubFolder{}, err
	}
	if userID <= 0 {
		return CollectionHubFolder{}, errors.New("invalid user id")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return CollectionHubFolder{}, errors.New("Enter a name for this folder.")
	}
	if len([]rune(name)) > 80 {
		return CollectionHubFolder{}, errors.New("Collection folder names must be 80 characters or fewer.")
	}
	var exists int
	if err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM movipilot_collections WHERE user_id = ? AND name = ? COLLATE NOCASE)`, userID, name).Scan(&exists); err != nil {
		return CollectionHubFolder{}, err
	}
	if exists != 0 {
		return CollectionHubFolder{}, errors.New("You already have a folder with that name. Try a unique name.")
	}
	result, err := DB.Exec(`INSERT INTO movipilot_collections(user_id, name) VALUES(?, ?)`, userID, name)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return CollectionHubFolder{}, errors.New("You already have a folder with that name. Try a unique name.")
		}
		return CollectionHubFolder{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return CollectionHubFolder{}, err
	}
	var folder CollectionHubFolder
	err = DB.QueryRow(`SELECT id, name, CAST(created_at AS TEXT) FROM movipilot_collections WHERE id = ? AND user_id = ?`, id, userID).Scan(&folder.ID, &folder.Name, &folder.CreatedAt)
	return folder, err
}

func ListCollectionHubFolderItems(userID, collectionID int64) ([]CollectionHubItem, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 || collectionID <= 0 {
		return nil, errors.New("invalid collection id")
	}
	var owns int
	if err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM movipilot_collections WHERE id = ? AND user_id = ?)`, collectionID, userID).Scan(&owns); err != nil {
		return nil, err
	}
	if owns == 0 {
		return nil, errors.New("This collection folder was not found.")
	}
	rows, err := DB.Query(`
SELECT ci.id, ci.media_type, ci.media_id, CAST(ci.created_at AS TEXT),
       COALESCE(s.title, ''), COALESCE(s.overview, ''), COALESCE(s.poster_url, ''),
       COALESCE(s.backdrop_url, ''), COALESCE(s.year, ''), COALESCE(s.vote_average, 0),
       COALESCE(s.media_type_label, '')
FROM movipilot_collection_items ci
JOIN movipilot_collections c ON c.id = ci.collection_id
LEFT JOIN movipilot_media_snapshots s ON s.media_type = ci.media_type AND s.media_id = ci.media_id
WHERE ci.collection_id = ? AND c.user_id = ?
ORDER BY ci.created_at DESC, ci.id DESC
`, collectionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CollectionHubItem, 0)
	for rows.Next() {
		var item CollectionHubItem
		if err := rows.Scan(&item.ID, &item.MediaType, &item.MediaID, &item.AddedAt, &item.Title, &item.Overview, &item.PosterURL, &item.BackdropURL, &item.Year, &item.VoteAverage, &item.MediaTypeLabel); err != nil {
			return nil, err
		}
		if item.MediaTypeLabel == "" {
			if item.MediaType == "tv" {
				item.MediaTypeLabel = "TV Series"
			} else {
				item.MediaTypeLabel = "Movie"
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func RemoveCollectionHubFolderItem(userID, itemID int64) (bool, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return false, err
	}
	if userID <= 0 || itemID <= 0 {
		return false, errors.New("invalid collection item id")
	}
	result, err := DB.Exec(`
DELETE FROM movipilot_collection_items
WHERE id = ? AND collection_id IN (
    SELECT id FROM movipilot_collections WHERE user_id = ?
)
`, itemID, userID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// DeleteCollectionHubFolder removes only the owner's folder and its items. Share
// records and their media snapshots intentionally survive so accepted shares
// remain in Shared with me even if the sender deletes the original folder.
func DeleteCollectionHubFolder(userID, collectionID int64) (bool, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return false, err
	}
	if userID <= 0 || collectionID <= 0 {
		return false, errors.New("invalid collection id")
	}
	tx, err := DB.Begin()
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`DELETE FROM movipilot_collection_items WHERE collection_id = ? AND EXISTS (SELECT 1 FROM movipilot_collections WHERE id = ? AND user_id = ?)`, collectionID, collectionID, userID)
	if err != nil {
		return false, err
	}
	_ = result
	result, err = tx.Exec(`DELETE FROM movipilot_collections WHERE id = ? AND user_id = ?`, collectionID, userID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected == 0 {
		return false, errors.New("This collection folder was not found.")
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func ListCollectionHubMarkedFriends(userID int64) ([]CollectionHubFriend, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.New("invalid user id")
	}
	rows, err := DB.Query(`
SELECT u.public_id, COALESCE(u.username, ''), COALESCE(NULLIF(TRIM(u.full_name), ''), u.username), CAST(u.created_at AS TEXT)
FROM community_friend_marks fm
JOIN users u ON u.id = fm.target_user_id
WHERE fm.user_id = ?
ORDER BY lower(COALESCE(NULLIF(TRIM(u.full_name), ''), u.username)), lower(u.username)
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	friends := make([]CollectionHubFriend, 0)
	for rows.Next() {
		var friend CollectionHubFriend
		if err := rows.Scan(&friend.PublicID, &friend.Username, &friend.FullName, &friend.CreatedAt); err != nil {
			return nil, err
		}
		friends = append(friends, friend)
	}
	return friends, rows.Err()
}

// ShareCollectionHubFolder sends a durable media snapshot to the sender's
// marked friends. Friend permission and folder ownership are rechecked in the
// same transaction that creates each share, so the client cannot spoof IDs.
func ShareCollectionHubFolder(userID, collectionID int64, recipientPublicIDs []string, message string) (int, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return 0, err
	}
	if userID <= 0 || collectionID <= 0 {
		return 0, errors.New("invalid collection id")
	}
	message = strings.TrimSpace(message)
	if len([]rune(message)) > 500 {
		return 0, errors.New("A sharing note must be 500 characters or fewer.")
	}
	if len(recipientPublicIDs) == 0 {
		return 0, errors.New("Choose at least one marked friend to share with.")
	}
	if len(recipientPublicIDs) > 50 {
		return 0, errors.New("Share with no more than 50 people at once.")
	}
	unique := make(map[string]bool)
	recipients := make([]string, 0, len(recipientPublicIDs))
	for _, value := range recipientPublicIDs {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || unique[key] {
			continue
		}
		unique[key] = true
		recipients = append(recipients, value)
	}
	if len(recipients) == 0 {
		return 0, errors.New("Choose at least one marked friend to share with.")
	}

	tx, err := DB.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	var folderName string
	if err := tx.QueryRow(`SELECT name FROM movipilot_collections WHERE id = ? AND user_id = ?`, collectionID, userID).Scan(&folderName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("This collection folder was not found.")
		}
		return 0, err
	}

	// Snapshot the title and media metadata from the existing Explore library.
	// Rebuild each share snapshot on resend so a declined share can be sent again.
	sent := 0
	for _, publicID := range recipients {
		var recipientID int64
		if err := tx.QueryRow(`SELECT id FROM users WHERE public_id = ? COLLATE NOCASE`, publicID).Scan(&recipientID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, errors.New("One of the selected members no longer exists. Refresh your marked-friends list and try again.")
			}
			return 0, err
		}
		if recipientID == userID {
			return 0, errors.New("You cannot share a collection with your own account.")
		}
		var isMarked int
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM community_friend_marks WHERE user_id = ? AND target_user_id = ?)`, userID, recipientID).Scan(&isMarked); err != nil {
			return 0, err
		}
		if isMarked == 0 {
			return 0, errors.New("Collections can only be shared with members you have marked as friends. Refresh your list and try again.")
		}
		if _, err := tx.Exec(`
INSERT INTO movipilot_collection_shares(source_collection_id, sender_user_id, recipient_user_id, collection_name, message, status, created_at, responded_at)
VALUES(?, ?, ?, ?, ?, 'pending', datetime('now'), NULL)
ON CONFLICT(source_collection_id, sender_user_id, recipient_user_id)
DO UPDATE SET collection_name = excluded.collection_name, message = excluded.message,
              status = 'pending', created_at = datetime('now'), responded_at = NULL
`, collectionID, userID, recipientID, folderName, message); err != nil {
			return 0, err
		}
		var shareID int64
		if err := tx.QueryRow(`SELECT id FROM movipilot_collection_shares WHERE source_collection_id = ? AND sender_user_id = ? AND recipient_user_id = ?`, collectionID, userID, recipientID).Scan(&shareID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`DELETE FROM movipilot_collection_share_items WHERE share_id = ?`, shareID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`
INSERT INTO movipilot_collection_share_items(
    share_id, media_type, media_id, source_added_at, title, overview, poster_url,
    backdrop_url, year, vote_average, media_type_label
)
SELECT ?, ci.media_type, ci.media_id, CAST(ci.created_at AS TEXT),
       COALESCE(s.title, ''), COALESCE(s.overview, ''), COALESCE(s.poster_url, ''),
       COALESCE(s.backdrop_url, ''), COALESCE(s.year, ''), COALESCE(s.vote_average, 0),
       COALESCE(s.media_type_label, CASE WHEN ci.media_type = 'tv' THEN 'TV Series' ELSE 'Movie' END)
FROM movipilot_collection_items ci
LEFT JOIN movipilot_media_snapshots s ON s.media_type = ci.media_type AND s.media_id = ci.media_id
WHERE ci.collection_id = ?
`, shareID, collectionID); err != nil {
			return 0, err
		}
		sent++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return sent, nil
}

func ListCollectionHubShares(userID int64, status string) ([]CollectionHubShare, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.New("invalid user id")
	}
	if status != "pending" && status != "accepted" {
		return nil, errors.New("invalid collection share status")
	}
	rows, err := DB.Query(`
SELECT sh.id, sh.source_collection_id, sh.collection_name, sh.message, sh.status,
       CAST(sh.created_at AS TEXT), COALESCE(CAST(sh.responded_at AS TEXT), ''),
       COUNT(si.id), u.public_id, COALESCE(u.username, ''),
       COALESCE(NULLIF(TRIM(u.full_name), ''), u.username), CAST(u.created_at AS TEXT)
FROM movipilot_collection_shares sh
JOIN users u ON u.id = sh.sender_user_id
LEFT JOIN movipilot_collection_share_items si ON si.share_id = sh.id
WHERE sh.recipient_user_id = ? AND sh.status = ?
GROUP BY sh.id, sh.source_collection_id, sh.collection_name, sh.message, sh.status,
         sh.created_at, sh.responded_at, u.public_id, u.username, u.full_name, u.created_at
ORDER BY sh.created_at DESC, sh.id DESC
`, userID, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	shares := make([]CollectionHubShare, 0)
	for rows.Next() {
		var share CollectionHubShare
		if err := rows.Scan(&share.ID, &share.CollectionID, &share.Name, &share.Message, &share.Status, &share.CreatedAt, &share.RespondedAt, &share.ItemCount, &share.Sender.PublicID, &share.Sender.Username, &share.Sender.FullName, &share.Sender.CreatedAt); err != nil {
			return nil, err
		}
		shares = append(shares, share)
	}
	return shares, rows.Err()
}

func RespondToCollectionHubShare(userID, shareID int64, action string) error {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return err
	}
	if userID <= 0 || shareID <= 0 {
		return errors.New("invalid collection share")
	}
	var status string
	switch action {
	case "accept":
		status = "accepted"
	case "decline":
		status = "declined"
	default:
		return errors.New("Choose accept or decline.")
	}
	result, err := DB.Exec(`UPDATE movipilot_collection_shares SET status = ?, responded_at = datetime('now') WHERE id = ? AND recipient_user_id = ? AND status = 'pending'`, status, shareID, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errors.New("This incoming collection is no longer pending. Refresh the list and try again.")
	}
	return nil
}

func ListAcceptedCollectionHubShareItems(userID, shareID int64) ([]CollectionHubItem, error) {
	if err := EnsureExploreCommunityCollectionSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 || shareID <= 0 {
		return nil, errors.New("invalid collection share")
	}
	var accepted int
	if err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM movipilot_collection_shares WHERE id = ? AND recipient_user_id = ? AND status = 'accepted')`, shareID, userID).Scan(&accepted); err != nil {
		return nil, err
	}
	if accepted == 0 {
		return nil, errors.New("This shared collection is unavailable or has not been accepted.")
	}
	rows, err := DB.Query(`
SELECT si.id, si.media_type, si.media_id, CAST(si.source_added_at AS TEXT), si.title, si.overview,
       si.poster_url, si.backdrop_url, si.year, si.vote_average, si.media_type_label
FROM movipilot_collection_share_items si
WHERE si.share_id = ?
ORDER BY si.source_added_at DESC, si.id DESC
`, shareID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CollectionHubItem, 0)
	for rows.Next() {
		var item CollectionHubItem
		if err := rows.Scan(&item.ID, &item.MediaType, &item.MediaID, &item.AddedAt, &item.Title, &item.Overview, &item.PosterURL, &item.BackdropURL, &item.Year, &item.VoteAverage, &item.MediaTypeLabel); err != nil {
			return nil, err
		}
		if item.MediaTypeLabel == "" {
			if item.MediaType == "tv" {
				item.MediaTypeLabel = "TV Series"
			} else {
				item.MediaTypeLabel = "Movie"
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
