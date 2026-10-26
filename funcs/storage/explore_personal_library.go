package storage

import (
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"
)

// ExplorePersonalLibraryItem is a privacy-safe view of one of the signed-in
// user's personal library entries. It contains no user account/authentication
// fields; only public TMDB metadata and the user's activity timestamps/rating.
type ExplorePersonalLibraryItem struct {
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
	AddedAt        string  `json:"addedAt,omitempty"`
	ViewedAt       string  `json:"viewedAt,omitempty"`
	ExpiresAt      string  `json:"expiresAt,omitempty"`
	RatedAt        string  `json:"ratedAt,omitempty"`
	Rating         int     `json:"rating,omitempty"`
}

var (
	explorePersonalSchemaOnce sync.Once
	explorePersonalSchemaErr  error
	exploreHistoryCleanupOnce sync.Once
)

const exploreHistoryRetentionDays = 7

// EnsureExplorePersonalLibrarySchema adds the metadata snapshot and recent-view
// tables without altering the existing watchlist, ratings, likes, or watched-
// recommendation tables. It is safe to call from startup and request handlers.
func EnsureExplorePersonalLibrarySchema() error {
	if DB == nil {
		return errors.New("storage database is not initialized")
	}
	if err := EnsureExploreTables(); err != nil {
		return err
	}

	explorePersonalSchemaOnce.Do(func() {
		_, explorePersonalSchemaErr = DB.Exec(`
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

CREATE TABLE IF NOT EXISTS movipilot_watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL CHECK (media_id > 0),
    viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, media_type, media_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_watch_history_user_viewed
ON movipilot_watch_history(user_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_movipilot_watch_history_expiry
ON movipilot_watch_history(viewed_at);
`)
		if explorePersonalSchemaErr == nil {
			// Also expire old rows during idle periods. The request paths below
			// prune on access as well, so the feature does not rely on this ticker.
			exploreHistoryCleanupOnce.Do(func() {
				go func() {
					ticker := time.NewTicker(6 * time.Hour)
					defer ticker.Stop()
					for range ticker.C {
						if DB != nil {
							_, _ = DB.Exec(`DELETE FROM movipilot_watch_history WHERE viewed_at < datetime('now', '-7 days')`)
						}
					}
				}()
			})
		}
	})
	return explorePersonalSchemaErr
}

// StoreExploreMediaSnapshot persists non-user-specific TMDB metadata for the
// current title. This lets library modals render immediately without a TMDB
// request for every already-known list item.
func StoreExploreMediaSnapshot(mediaType string, mediaID int64, title, overview, posterURL, backdropURL, year string, voteAverage float64, mediaTypeLabel string) error {
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		return err
	}
	if !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid media identifier")
	}
	return upsertExploreMediaSnapshot(DB, mediaType, mediaID, title, overview, posterURL, backdropURL, year, voteAverage, mediaTypeLabel)
}

// RecordExploreMediaVisit stores the snapshot and, only for authenticated
// users, upserts one recent-view row for this title. Reopening the same title
// refreshes viewed_at instead of creating duplicate history rows.
func RecordExploreMediaVisit(userID int64, loggedIn bool, mediaType string, mediaID int64, title, overview, posterURL, backdropURL, year string, voteAverage float64, mediaTypeLabel string) error {
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		return err
	}
	if !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid media identifier")
	}
	if loggedIn && userID <= 0 {
		return errors.New("invalid user identifier")
	}

	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if err := upsertExploreMediaSnapshot(tx, mediaType, mediaID, title, overview, posterURL, backdropURL, year, voteAverage, mediaTypeLabel); err != nil {
		return err
	}
	if loggedIn {
		if _, err := tx.Exec(`
INSERT INTO movipilot_watch_history(user_id, media_type, media_id, viewed_at)
VALUES(?, ?, ?, datetime('now'))
ON CONFLICT(user_id, media_type, media_id)
DO UPDATE SET viewed_at = datetime('now')
`, userID, mediaType, mediaID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM movipilot_watch_history WHERE viewed_at < datetime('now', '-7 days')`); err != nil {
		return err
	}
	return tx.Commit()
}

type exploreSnapshotExecutor interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func upsertExploreMediaSnapshot(exec exploreSnapshotExecutor, mediaType string, mediaID int64, title, overview, posterURL, backdropURL, year string, voteAverage float64, mediaTypeLabel string) error {
	_, err := exec.Exec(`
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

// ListExplorePersonalLibraryItems reads a user's watchlist, recent history, or
// saved ratings. kind must be watchlist, history, or ratings.
func ListExplorePersonalLibraryItems(userID int64, kind string) ([]ExplorePersonalLibraryItem, error) {
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.New("invalid user identifier")
	}

	var query string
	switch kind {
	case "watchlist":
		query = `
SELECT w.id, w.media_type, w.media_id,
       COALESCE(s.title, ''), COALESCE(s.overview, ''), COALESCE(s.poster_url, ''),
       COALESCE(s.backdrop_url, ''), COALESCE(s.year, ''), COALESCE(s.vote_average, 0),
       COALESCE(s.media_type_label, ''), w.created_at, 0
FROM movipilot_watchlist w
LEFT JOIN movipilot_media_snapshots s ON s.media_type = w.media_type AND s.media_id = w.media_id
WHERE w.user_id = ?
ORDER BY w.created_at DESC, w.id DESC`
	case "history":
		if _, err := DB.Exec(`DELETE FROM movipilot_watch_history WHERE viewed_at < datetime('now', '-7 days')`); err != nil {
			return nil, err
		}
		query = `
SELECT h.id, h.media_type, h.media_id,
       COALESCE(s.title, ''), COALESCE(s.overview, ''), COALESCE(s.poster_url, ''),
       COALESCE(s.backdrop_url, ''), COALESCE(s.year, ''), COALESCE(s.vote_average, 0),
       COALESCE(s.media_type_label, ''), h.viewed_at, 0
FROM movipilot_watch_history h
LEFT JOIN movipilot_media_snapshots s ON s.media_type = h.media_type AND s.media_id = h.media_id
WHERE h.user_id = ? AND h.viewed_at >= datetime('now', '-7 days')
ORDER BY h.viewed_at DESC, h.id DESC`
	case "ratings":
		query = `
SELECT r.id, r.media_type, r.media_id,
       COALESCE(s.title, ''), COALESCE(s.overview, ''), COALESCE(s.poster_url, ''),
       COALESCE(s.backdrop_url, ''), COALESCE(s.year, ''), COALESCE(s.vote_average, 0),
       COALESCE(s.media_type_label, ''), r.updated_at, r.rating
FROM movipilot_ratings r
LEFT JOIN movipilot_media_snapshots s ON s.media_type = r.media_type AND s.media_id = r.media_id
WHERE r.user_id = ?
ORDER BY r.updated_at DESC, r.id DESC`
	default:
		return nil, errors.New("invalid personal library type")
	}

	rows, err := DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ExplorePersonalLibraryItem, 0)
	for rows.Next() {
		var item ExplorePersonalLibraryItem
		var activityAt string
		if err := rows.Scan(
			&item.ID, &item.MediaType, &item.MediaID, &item.Title, &item.Overview,
			&item.PosterURL, &item.BackdropURL, &item.Year, &item.VoteAverage,
			&item.MediaTypeLabel, &activityAt, &item.Rating,
		); err != nil {
			return nil, err
		}
		switch kind {
		case "watchlist":
			item.AddedAt = activityAt
		case "history":
			item.ViewedAt = activityAt
		case "ratings":
			item.RatedAt = activityAt
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// RemoveExploreWatchlist removes a row directly instead of using the existing
// toggle API, so double-clicks/retries cannot accidentally re-add the title.
func RemoveExploreWatchlist(userID int64, mediaType string, mediaID int64) (bool, error) {
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		return false, err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return false, errors.New("invalid user/media identifier")
	}
	result, err := DB.Exec(`DELETE FROM movipilot_watchlist WHERE user_id = ? AND media_type = ? AND media_id = ?`, userID, mediaType, mediaID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

// RemoveExploreWatchHistory lets a user remove a recent-view entry manually.
func RemoveExploreWatchHistory(userID int64, mediaType string, mediaID int64) (bool, error) {
	if err := EnsureExplorePersonalLibrarySchema(); err != nil {
		return false, err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return false, errors.New("invalid user/media identifier")
	}
	result, err := DB.Exec(`DELETE FROM movipilot_watch_history WHERE user_id = ? AND media_type = ? AND media_id = ?`, userID, mediaType, mediaID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}
