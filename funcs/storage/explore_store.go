package storage

import (
	"database/sql"
	"errors"
	"strings"
)

type ExploreCommunity struct {
	LikeCount        int
	CurrentUserLiked bool
	CommunityRating  float64
	RatingCount      int
	Reviews          []ExploreReview
}

type ExploreReview struct {
	ID         int64
	AuthorName string
	Review     string
	CreatedAt  string
}

type ExploreUserState struct {
	LoggedIn    bool
	Watchlisted bool
	Liked       bool
	Rating      int
	CanRate     bool
	Collections []ExploreCollectionSummary
}

type ExploreCollectionSummary struct {
	ID        int64
	Name      string
	ItemCount int
}

func validExploreMediaType(mediaType string) bool {
	return mediaType == "movie" || mediaType == "tv"
}

func requireExploreSchema() error {
	return EnsureExploreTables()
}

func GetExploreCommunity(mediaType string, mediaID int64, userID int64, loggedIn bool) (ExploreCommunity, error) {
	if err := requireExploreSchema(); err != nil {
		return ExploreCommunity{}, err
	}
	if !validExploreMediaType(mediaType) || mediaID <= 0 {
		return ExploreCommunity{}, errors.New("invalid media identifier")
	}

	var out ExploreCommunity

	if err := DB.QueryRow(`
SELECT COUNT(*)
FROM movipilot_likes
WHERE media_type = ? AND media_id = ?
`, mediaType, mediaID).Scan(&out.LikeCount); err != nil {
		return ExploreCommunity{}, err
	}

	var ratingSum sql.NullFloat64
	if err := DB.QueryRow(`
SELECT AVG(rating)
FROM movipilot_ratings
WHERE media_type = ? AND media_id = ?
`, mediaType, mediaID).Scan(&ratingSum); err != nil {
		return ExploreCommunity{}, err
	}
	if ratingSum.Valid {
		out.CommunityRating = ratingSum.Float64
	}

	if err := DB.QueryRow(`
SELECT COUNT(*)
FROM movipilot_ratings
WHERE media_type = ? AND media_id = ?
`, mediaType, mediaID).Scan(&out.RatingCount); err != nil {
		return ExploreCommunity{}, err
	}

	if loggedIn {
		var liked int
		if err := DB.QueryRow(`
SELECT EXISTS(
    SELECT 1
    FROM movipilot_likes
    WHERE user_id = ? AND media_type = ? AND media_id = ?
)
`, userID, mediaType, mediaID).Scan(&liked); err != nil {
			return ExploreCommunity{}, err
		}
		out.CurrentUserLiked = liked == 1
	}

	rows, err := DB.Query(`
SELECT
    r.id,
    COALESCE(NULLIF(TRIM(u.full_name), ''), 'MoviPilot User') AS author_name,
    r.review,
    r.created_at
FROM movipilot_reviews r
JOIN users u ON u.id = r.user_id
WHERE r.media_type = ? AND r.media_id = ?
ORDER BY r.created_at DESC, r.id DESC
LIMIT 50
`, mediaType, mediaID)
	if err != nil {
		return ExploreCommunity{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var review ExploreReview
		if err := rows.Scan(
			&review.ID,
			&review.AuthorName,
			&review.Review,
			&review.CreatedAt,
		); err != nil {
			return ExploreCommunity{}, err
		}
		out.Reviews = append(out.Reviews, review)
	}

	if err := rows.Err(); err != nil {
		return ExploreCommunity{}, err
	}

	return out, nil
}

func GetExploreUserState(userID int64, mediaType string, mediaID int64) (ExploreUserState, error) {
	if err := requireExploreSchema(); err != nil {
		return ExploreUserState{}, err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return ExploreUserState{}, errors.New("invalid user/media identifier")
	}

	var state ExploreUserState
	state.LoggedIn = true

	var exists int
	if err := DB.QueryRow(`
SELECT EXISTS(
    SELECT 1 FROM movipilot_watchlist
    WHERE user_id = ? AND media_type = ? AND media_id = ?
)
`, userID, mediaType, mediaID).Scan(&exists); err != nil {
		return ExploreUserState{}, err
	}
	state.Watchlisted = exists == 1

	if err := DB.QueryRow(`
SELECT EXISTS(
    SELECT 1 FROM movipilot_likes
    WHERE user_id = ? AND media_type = ? AND media_id = ?
)
`, userID, mediaType, mediaID).Scan(&exists); err != nil {
		return ExploreUserState{}, err
	}
	state.Liked = exists == 1

	var rating sql.NullInt64
	if err := DB.QueryRow(`
SELECT rating
FROM movipilot_ratings
WHERE user_id = ? AND media_type = ? AND media_id = ?
`, userID, mediaType, mediaID).Scan(&rating); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ExploreUserState{}, err
	}
	if rating.Valid {
		state.Rating = int(rating.Int64)
	}

	if err := DB.QueryRow(`
SELECT EXISTS(
    SELECT 1
    FROM movipilot_watch_events
    WHERE user_id = ?
      AND media_type = ?
      AND media_id = ?
      AND source = 'recommendation'
)
`, userID, mediaType, mediaID).Scan(&exists); err != nil {
		return ExploreUserState{}, err
	}
	state.CanRate = exists == 1

	rows, err := DB.Query(`
SELECT
    c.id,
    c.name,
    COUNT(ci.id) AS item_count
FROM movipilot_collections c
LEFT JOIN movipilot_collection_items ci
    ON ci.collection_id = c.id
WHERE c.user_id = ?
GROUP BY c.id, c.name
ORDER BY c.created_at DESC, c.id DESC
`, userID)
	if err != nil {
		return ExploreUserState{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var c ExploreCollectionSummary
		if err := rows.Scan(&c.ID, &c.Name, &c.ItemCount); err != nil {
			return ExploreUserState{}, err
		}
		state.Collections = append(state.Collections, c)
	}

	return state, rows.Err()
}

func ToggleExploreWatchlist(userID int64, mediaType string, mediaID int64) (bool, error) {
	if err := requireExploreSchema(); err != nil {
		return false, err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return false, errors.New("invalid user/media identifier")
	}

	result, err := DB.Exec(`
DELETE FROM movipilot_watchlist
WHERE user_id = ? AND media_type = ? AND media_id = ?
`, userID, mediaType, mediaID)
	if err != nil {
		return false, err
	}

	if n, _ := result.RowsAffected(); n > 0 {
		return false, nil
	}

	_, err = DB.Exec(`
INSERT INTO movipilot_watchlist(user_id, media_type, media_id)
VALUES(?, ?, ?)
`, userID, mediaType, mediaID)
	if err != nil {
		return false, err
	}
	return true, nil
}

func ToggleExploreLike(userID int64, mediaType string, mediaID int64) (bool, int, error) {
	if err := requireExploreSchema(); err != nil {
		return false, 0, err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return false, 0, errors.New("invalid user/media identifier")
	}

	result, err := DB.Exec(`
DELETE FROM movipilot_likes
WHERE user_id = ? AND media_type = ? AND media_id = ?
`, userID, mediaType, mediaID)
	if err != nil {
		return false, 0, err
	}

	liked := false
	if n, _ := result.RowsAffected(); n == 0 {
		_, err = DB.Exec(`
INSERT INTO movipilot_likes(user_id, media_type, media_id)
VALUES(?, ?, ?)
`, userID, mediaType, mediaID)
		if err != nil {
			return false, 0, err
		}
		liked = true
	}

	var count int
	err = DB.QueryRow(`
SELECT COUNT(*)
FROM movipilot_likes
WHERE media_type = ? AND media_id = ?
`, mediaType, mediaID).Scan(&count)
	return liked, count, err
}

func SaveExploreRating(userID int64, mediaType string, mediaID int64, rating int) error {
	if err := requireExploreSchema(); err != nil {
		return err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid user/media identifier")
	}
	if rating < 1 || rating > 5 {
		return errors.New("rating must be between 1 and 5")
	}

	var canRate int
	if err := DB.QueryRow(`
SELECT EXISTS(
    SELECT 1
    FROM movipilot_watch_events
    WHERE user_id = ?
      AND media_type = ?
      AND media_id = ?
      AND source = 'recommendation'
)
`, userID, mediaType, mediaID).Scan(&canRate); err != nil {
		return err
	}
	if canRate != 1 {
		return errors.New("rating is available after this title is marked watched from a recommendation")
	}

	_, err := DB.Exec(`
INSERT INTO movipilot_ratings(user_id, media_type, media_id, rating)
VALUES(?, ?, ?, ?)
ON CONFLICT(user_id, media_type, media_id)
DO UPDATE SET
    rating = excluded.rating,
    updated_at = datetime('now')
`, userID, mediaType, mediaID, rating)
	return err
}

func RecordExploreWatchEvent(userID int64, mediaType string, mediaID int64, source string) error {
	if err := requireExploreSchema(); err != nil {
		return err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid user/media identifier")
	}
	if source != "recommendation" && source != "other" {
		return errors.New("invalid watch source")
	}
	_, err := DB.Exec(`
INSERT INTO movipilot_watch_events(user_id, media_type, media_id, source)
VALUES(?, ?, ?, ?)
`, userID, mediaType, mediaID, source)
	return err
}

func CreateExploreReview(userID int64, mediaType string, mediaID int64, review string) error {
	if err := requireExploreSchema(); err != nil {
		return err
	}
	if userID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid user/media identifier")
	}
	review = strings.TrimSpace(review)
	if review == "" {
		return errors.New("review cannot be empty")
	}
	if len([]rune(review)) > 2000 {
		return errors.New("review is too long")
	}
	_, err := DB.Exec(`
INSERT INTO movipilot_reviews(user_id, media_type, media_id, review)
VALUES(?, ?, ?, ?)
`, userID, mediaType, mediaID, review)
	return err
}

func GetExploreCollections(userID int64) ([]ExploreCollectionSummary, error) {
	if err := requireExploreSchema(); err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.New("invalid user id")
	}
	rows, err := DB.Query(`
SELECT
    c.id,
    c.name,
    COUNT(ci.id) AS item_count
FROM movipilot_collections c
LEFT JOIN movipilot_collection_items ci
    ON ci.collection_id = c.id
WHERE c.user_id = ?
GROUP BY c.id, c.name
ORDER BY c.created_at DESC, c.id DESC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var collections []ExploreCollectionSummary
	for rows.Next() {
		var c ExploreCollectionSummary
		if err := rows.Scan(&c.ID, &c.Name, &c.ItemCount); err != nil {
			return nil, err
		}
		collections = append(collections, c)
	}
	return collections, rows.Err()
}

func CreateExploreCollection(userID int64, name string) (ExploreCollectionSummary, error) {
	if err := requireExploreSchema(); err != nil {
		return ExploreCollectionSummary{}, err
	}
	if userID <= 0 {
		return ExploreCollectionSummary{}, errors.New("invalid user id")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ExploreCollectionSummary{}, errors.New("collection name cannot be empty")
	}
	if len([]rune(name)) > 80 {
		return ExploreCollectionSummary{}, errors.New("collection name is too long")
	}

	result, err := DB.Exec(`
INSERT OR IGNORE INTO movipilot_collections(user_id, name)
VALUES(?, ?)
`, userID, name)
	if err != nil {
		return ExploreCollectionSummary{}, err
	}

	_ = result

	var c ExploreCollectionSummary
	err = DB.QueryRow(`
SELECT id, name
FROM movipilot_collections
WHERE user_id = ? AND name = ?
`, userID, name).Scan(&c.ID, &c.Name)
	if err != nil {
		return ExploreCollectionSummary{}, err
	}
	return c, nil
}

func AddExploreCollectionItem(userID int64, collectionID int64, mediaType string, mediaID int64) error {
	if err := requireExploreSchema(); err != nil {
		return err
	}
	if userID <= 0 || collectionID <= 0 || !validExploreMediaType(mediaType) || mediaID <= 0 {
		return errors.New("invalid collection/media identifier")
	}

	var owner int64
	if err := DB.QueryRow(`
SELECT user_id
FROM movipilot_collections
WHERE id = ?
`, collectionID).Scan(&owner); err != nil {
		return err
	}
	if owner != userID {
		return errors.New("collection does not belong to current user")
	}

	_, err := DB.Exec(`
INSERT OR IGNORE INTO movipilot_collection_items(
    collection_id, media_type, media_id
)
VALUES(?, ?, ?)
`, collectionID, mediaType, mediaID)
	return err
}
