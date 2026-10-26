package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"MoviPilot/funcs/storage"
)

const personalHistoryRetention = 7 * 24 * time.Hour

// ExplorePersonalWatchlistAPI serves the My MoviPilot Watchlist modal.
// GET lists the signed-in user's entries; DELETE removes one entry directly.
func ExplorePersonalWatchlistAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := listPersonalLibraryItems(userID, "watchlist")
		if err != nil {
			jsonError(w, "Could not load your Watchlist right now.", http.StatusInternalServerError)
			return
		}
		writePersonalLibraryJSON(w, map[string]interface{}{"success": true, "items": items, "count": len(items)})

	case http.MethodDelete:
		if !personalLibrarySameOrigin(r) {
			jsonError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		mediaType, mediaID, err := parseExploreQuery(r)
		if err != nil {
			jsonError(w, "Choose a valid movie or TV title.", http.StatusBadRequest)
			return
		}
		removed, err := storage.RemoveExploreWatchlist(userID, mediaType, mediaID)
		if err != nil {
			jsonError(w, "Could not remove this title from your Watchlist.", http.StatusInternalServerError)
			return
		}
		writePersonalLibraryJSON(w, map[string]interface{}{"success": true, "removed": removed})

	default:
		w.Header().Set("Allow", "GET, DELETE")
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ExplorePersonalHistoryAPI powers the seven-day Recently Explored modal.
// Expired rows are pruned by storage on read and by its periodic cleanup task.
func ExplorePersonalHistoryAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := listPersonalLibraryItems(userID, "history")
		if err != nil {
			jsonError(w, "Could not load your recent Explore history right now.", http.StatusInternalServerError)
			return
		}
		writePersonalLibraryJSON(w, map[string]interface{}{"success": true, "items": items, "count": len(items), "retentionDays": 7})

	case http.MethodDelete:
		if !personalLibrarySameOrigin(r) {
			jsonError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		mediaType, mediaID, err := parseExploreQuery(r)
		if err != nil {
			jsonError(w, "Choose a valid movie or TV title.", http.StatusBadRequest)
			return
		}
		removed, err := storage.RemoveExploreWatchHistory(userID, mediaType, mediaID)
		if err != nil {
			jsonError(w, "Could not remove this title from your history.", http.StatusInternalServerError)
			return
		}
		writePersonalLibraryJSON(w, map[string]interface{}{"success": true, "removed": removed})

	default:
		w.Header().Set("Allow", "GET, DELETE")
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ExplorePersonalRatingsAPI returns titles for which the signed-in user has a
// persisted rating. It intentionally uses the existing movipilot_ratings data.
func ExplorePersonalRatingsAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	items, err := listPersonalLibraryItems(userID, "ratings")
	if err != nil {
		jsonError(w, "Could not load your saved ratings right now.", http.StatusInternalServerError)
		return
	}
	writePersonalLibraryJSON(w, map[string]interface{}{"success": true, "items": items, "count": len(items)})
}

func listPersonalLibraryItems(userID int64, kind string) ([]storage.ExplorePersonalLibraryItem, error) {
	items, err := storage.ListExplorePersonalLibraryItems(userID, kind)
	if err != nil {
		return nil, err
	}

	// Older Watchlist/Rating entries may predate the metadata snapshot table.
	// Backfill those from the same TMDB-powered Explore loader, with a small
	// concurrency limit. Any individual TMDB failure degrades to a clear
	// placeholder rather than breaking the user's whole modal.
	var group sync.WaitGroup
	semaphore := make(chan struct{}, 4)
	for index := range items {
		if strings.TrimSpace(items[index].Title) != "" {
			continue
		}
		group.Add(1)
		go func(index int) {
			defer group.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			item := &items[index]
			media, fetchErr := getExploreMedia(item.MediaType, item.MediaID)
			if fetchErr == nil && strings.TrimSpace(media.Title) != "" {
				item.Title = media.Title
				item.Overview = media.Overview
				item.PosterURL = media.PosterURL
				item.BackdropURL = media.BackdropURL
				item.Year = media.Year
				item.VoteAverage = float64(media.VoteAverage)
				item.MediaTypeLabel = media.MediaTypeLabel
				_ = storage.StoreExploreMediaSnapshot(item.MediaType, item.MediaID, item.Title, item.Overview, item.PosterURL, item.BackdropURL, item.Year, item.VoteAverage, item.MediaTypeLabel)
			}
		}(index)
	}
	group.Wait()

	for index := range items {
		item := &items[index]
		if strings.TrimSpace(item.MediaTypeLabel) == "" {
			if item.MediaType == "tv" {
				item.MediaTypeLabel = "TV Series"
			} else {
				item.MediaTypeLabel = "Movie"
			}
		}
		if strings.TrimSpace(item.Title) == "" {
			item.Title = fmt.Sprintf("%s #%d", item.MediaTypeLabel, item.MediaID)
		}
		item.AddedAt = normalizePersonalLibraryTime(item.AddedAt)
		item.ViewedAt = normalizePersonalLibraryTime(item.ViewedAt)
		item.RatedAt = normalizePersonalLibraryTime(item.RatedAt)
		if item.ViewedAt != "" {
			if viewedAt, ok := parsePersonalLibraryTime(item.ViewedAt); ok {
				item.ExpiresAt = viewedAt.Add(personalHistoryRetention).UTC().Format(time.RFC3339)
			}
		}
	}
	return items, nil
}

func normalizePersonalLibraryTime(value string) string {
	if parsed, ok := parsePersonalLibraryTime(value); ok {
		return parsed.UTC().Format(time.RFC3339)
	}
	return strings.TrimSpace(value)
}

func parsePersonalLibraryTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	layouts := []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		var parsed time.Time
		var err error
		if layout == time.RFC3339Nano || strings.Contains(layout, "-07:00") {
			parsed, err = time.Parse(layout, value)
		} else {
			parsed, err = time.ParseInLocation(layout, value, time.UTC)
		}
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func writePersonalLibraryJSON(w http.ResponseWriter, payload map[string]interface{}) {
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	writeJSON(w, payload)
}

func personalLibrarySameOrigin(r *http.Request) bool {
	candidate := strings.TrimSpace(r.Header.Get("Origin"))
	if candidate == "" {
		candidate = strings.TrimSpace(r.Header.Get("Referer"))
	}
	if candidate == "" || r.Host == "" {
		return false
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Host == "" {
		return false
	}
	return strings.EqualFold(parsed.Host, r.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https")
}
