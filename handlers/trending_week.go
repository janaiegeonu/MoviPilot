package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"time"

	tmdb "github.com/benlei/go-tmdb/v2"
)

const (
	trendingWeekCacheTTL = 30 * time.Minute
	trendingWeekStaleTTL = 6 * time.Hour
)

// TrendingWeekMovie is the small, template-independent shape used by the
// dashboard's Trending This Week rail. Keep this separate from TMDB's model
// so the browser receives only the fields that the UI needs.
type TrendingWeekMovie struct {
	ID          int64    `json:"id"`
	Title       string   `json:"title"`
	Overview    string   `json:"overview"`
	ReleaseDate string   `json:"releaseDate"`
	Year        string   `json:"year"`
	Rating      float32  `json:"rating"`
	VoteCount   int64    `json:"voteCount"`
	Language    string   `json:"language"`
	Genres      []string `json:"genres"`
	PosterURL   string   `json:"posterUrl"`
	BackdropURL string   `json:"backdropUrl"`
	ExploreURL  string   `json:"exploreUrl"`
	Rank        int      `json:"rank"`
}

// TrendingWeekMoviesPayload is returned by GET /api/dashboard/trending-week.
type TrendingWeekMoviesPayload struct {
	Items     []TrendingWeekMovie `json:"items"`
	Count     int                 `json:"count"`
	UpdatedAt time.Time           `json:"updatedAt"`
	Stale     bool                `json:"stale,omitempty"`
}

// TrendingWeekTMDBClient is satisfied by *tmdb.Client. Keeping this tiny
// interface makes the handler straightforward to test without a live API key.
type TrendingWeekTMDBClient interface {
	GetTrending(mediaType string, timeWindow string) (*tmdb.Trending, error)
}

type trendingWeekCache struct {
	mu        sync.Mutex
	payload   TrendingWeekMoviesPayload
	fetchedAt time.Time
}

// NewTrendingWeekMoviesHandler creates the API handler for the desktop
// dashboard's weekly movie rail.
//
// Pass the already-initialized MoviPilot TMDB client. The handler reuses that
// client and caches the weekly response for 30 minutes to avoid unnecessary
// TMDB requests. If TMDB temporarily fails, a previously fetched response can
// be served for up to six hours.
func NewTrendingWeekMoviesHandler(client TrendingWeekTMDBClient) http.Handler {
	cache := &trendingWeekCache{}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=1800")

		if isNilTrendingWeekClient(client) {
			http.Error(w, "TMDB client is not configured", http.StatusServiceUnavailable)
			return
		}

		// One mutex intentionally protects both the cache check and the fetch.
		// This prevents a burst of dashboard requests from issuing duplicate
		// requests to TMDB when the cache expires.
		cache.mu.Lock()
		defer cache.mu.Unlock()

		now := time.Now().UTC()
		if len(cache.payload.Items) > 0 && now.Sub(cache.fetchedAt) < trendingWeekCacheTTL {
			writeTrendingWeekJSON(w, cache.payload)
			return
		}

		trending, err := client.GetTrending("movie", "week")
		if err != nil {
			log.Printf("[dashboard trending week] TMDB request failed: %v", err)

			if len(cache.payload.Items) > 0 && now.Sub(cache.fetchedAt) < trendingWeekStaleTTL {
				stalePayload := cache.payload
				stalePayload.Stale = true
				writeTrendingWeekJSON(w, stalePayload)
				return
			}

			http.Error(w, "weekly movie trends are temporarily unavailable", http.StatusBadGateway)
			return
		}

		items := buildTrendingWeekMovies(trending)
		if len(items) == 0 {
			log.Printf("[dashboard trending week] TMDB returned no usable movie results")
			if len(cache.payload.Items) > 0 && now.Sub(cache.fetchedAt) < trendingWeekStaleTTL {
				stalePayload := cache.payload
				stalePayload.Stale = true
				writeTrendingWeekJSON(w, stalePayload)
				return
			}
			http.Error(w, "no weekly movie trends are available right now", http.StatusBadGateway)
			return
		}

		payload := TrendingWeekMoviesPayload{
			Items:     items,
			Count:     len(items),
			UpdatedAt: now,
		}

		cache.payload = payload
		cache.fetchedAt = now

		writeTrendingWeekJSON(w, payload)
	})
}

func isNilTrendingWeekClient(client TrendingWeekTMDBClient) bool {
	if client == nil {
		return true
	}

	value := reflect.ValueOf(client)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Ptr, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}

func writeTrendingWeekJSON(w http.ResponseWriter, payload TrendingWeekMoviesPayload) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[dashboard trending week] could not encode response: %v", err)
	}
}

func buildTrendingWeekMovies(response *tmdb.Trending) []TrendingWeekMovie {
	if response == nil || response.TrendingResults == nil {
		return nil
	}

	items := make([]TrendingWeekMovie, 0, len(response.Results))
	for _, result := range response.Results {
		if result == nil || result.ID <= 0 {
			continue
		}

		title := strings.TrimSpace(result.Title)
		if title == "" {
			continue
		}

		rank := len(items) + 1
		items = append(items, TrendingWeekMovie{
			ID:          result.ID,
			Title:       title,
			Overview:    strings.TrimSpace(result.Overview),
			ReleaseDate: strings.TrimSpace(result.ReleaseDate),
			Year:        releaseYear(result.ReleaseDate),
			Rating:      result.VoteAverage,
			VoteCount:   result.VoteCount,
			Language:    strings.ToUpper(strings.TrimSpace(result.OriginalLanguage)),
			Genres:      genreNames(result.GenreIDs),
			PosterURL:   tmdbImageURL(result.PosterPath, "w342"),
			BackdropURL: tmdbImageURL(result.BackdropPath, "w780"),
			ExploreURL:  fmt.Sprintf("/explore?type=movie&id=%d", result.ID),
			Rank:        rank,
		})
	}

	return items
}

func tmdbImageURL(path, size string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return "https://image.tmdb.org/t/p/" + size + path
}

func releaseYear(releaseDate string) string {
	releaseDate = strings.TrimSpace(releaseDate)
	if len(releaseDate) < 4 {
		return ""
	}
	year := releaseDate[:4]
	for _, character := range year {
		if character < '0' || character > '9' {
			return ""
		}
	}
	return year
}

func genreNames(ids []int64) []string {
	genreLookup := map[int64]string{
		28:    "Action",
		12:    "Adventure",
		16:    "Animation",
		35:    "Comedy",
		80:    "Crime",
		99:    "Documentary",
		18:    "Drama",
		10751: "Family",
		14:    "Fantasy",
		36:    "History",
		27:    "Horror",
		10402: "Music",
		9648:  "Mystery",
		10749: "Romance",
		878:   "Science Fiction",
		10770: "TV Movie",
		53:    "Thriller",
		10752: "War",
		37:    "Western",
	}

	genres := make([]string, 0, 3)
	for _, id := range ids {
		if name, ok := genreLookup[id]; ok {
			genres = append(genres, name)
			if len(genres) == 3 {
				break
			}
		}
	}
	return genres
}
