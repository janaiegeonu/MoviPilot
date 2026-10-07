package storage

import (
	"errors"
	"sync"
)

var (
	exploreSchemaOnce sync.Once
	exploreSchemaErr  error
)

// EnsureExploreTables creates the user-facing Explore tables once.
// Call it during DB startup after DB has been opened; the handlers also
// call it defensively so the feature cannot fail because startup wiring
// was missed.
func EnsureExploreTables() error {
	if DB == nil {
		return errors.New("storage database is not initialized")
	}

	exploreSchemaOnce.Do(func() {

		_, exploreSchemaErr = DB.Exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS movipilot_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, media_type, media_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_watchlist_user
ON movipilot_watchlist(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_watch_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('recommendation', 'other')),
    watched_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_watch_events_user_media
ON movipilot_watch_events(user_id, media_type, media_id, watched_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, media_type, media_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_ratings_media
ON movipilot_ratings(media_type, media_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, media_type, media_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_likes_media
ON movipilot_likes(media_type, media_id);

CREATE TABLE IF NOT EXISTS movipilot_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    review TEXT NOT NULL CHECK (length(trim(review)) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_reviews_media
ON movipilot_reviews(media_type, media_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_collections_user
ON movipilot_collections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movipilot_collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(collection_id, media_type, media_id),
    FOREIGN KEY(collection_id) REFERENCES movipilot_collections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movipilot_collection_items_collection
ON movipilot_collection_items(collection_id, created_at DESC);
`)
	})

	return exploreSchemaErr
}
