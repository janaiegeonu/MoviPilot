package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/benlei/go-tmdb/v2"
)

const (
	searchPageResultLimit = 40 // TMDB returns up to 20 items per media type per page.
	searchSuggestionLimit = 8
	searchKeywordLimit    = 12
)

// SearchPageData is the complete view model for the MoviPilot search page.
// Keep field names aligned with templates/search_page.html.
type SearchPageData struct {
	Query           string
	Mode            string
	MediaFilter     string
	GenreID         string
	GenreName       string
	Year            string
	TitleYear       string
	YearGenreID     string
	YearGenreName   string
	HeroBackdrops   []string
	Keyword         string
	KeywordID       string
	Heading         string
	Subheading      string
	Results         []SearchPageCard
	Recommendations []SearchPageCard
	KeywordPills    []SearchPageKeyword
	Genres          []SearchPageGenre
	YearOptions     []int
	TotalResults    int64
	Page            int
	TotalPages      int
	PreviousPage    int
	NextPage        int
	HasPrevious     bool
	HasNext         bool
	HasActiveSearch bool
	IsLanding       bool
	ErrorMessage    string
}

type SearchPageCard struct {
	ID            int64
	MediaType     string
	Title         string
	OriginalTitle string
	Overview      string
	PosterURL     string
	BackdropURL   string
	Year          string
	Rating        float32
	VoteCount     int64
	Popularity    float32
	GenreLabels   []string
}

type SearchPageGenre struct {
	ID   int64
	Name string
}

type SearchPageKeyword struct {
	ID   int64
	Name string
}

type searchPageSuggestion struct {
	ID        int64   `json:"id,omitempty"`
	Name      string  `json:"name"`
	Type      string  `json:"type,omitempty"`
	Year      string  `json:"year,omitempty"`
	PosterURL string  `json:"posterURL,omitempty"`
	Rating    float32 `json:"rating,omitempty"`
}

type searchGenreCacheState struct {
	sync.RWMutex
	Genres    []SearchPageGenre
	ExpiresAt time.Time
}

var searchGenresCache searchGenreCacheState

type searchHeroBackdropCacheState struct {
	sync.RWMutex
	Backdrops []string
	ExpiresAt time.Time
}

var searchHeroBackdropsCache searchHeroBackdropCacheState

// SearchPageHandler renders /search using TMDB's search and discover APIs.
func SearchPageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	data := newSearchPageData(r.URL.Query())
	client, err := newMovieTMDBClient()
	if err != nil {
		fmt.Println("[SEARCH TMDB CLIENT ERROR]", err)
		data.ErrorMessage = "MoviPilot could not connect to the movie library just now. Please refresh the page in a moment."
		data.Genres = searchDefaultGenres()
		searchFinishPageData(&data)
		searchRenderPage(w, data)
		return
	}

	genres, genreErr := searchLoadGenres(client)
	if genreErr != nil || len(genres) == 0 {
		genres = searchDefaultGenres()
	}
	data.Genres = genres

	genreIndex := searchBuildGenreIndex(genres)
	if data.GenreID != "" {
		if id, parseErr := strconv.ParseInt(data.GenreID, 10, 64); parseErr == nil {
			if name := genreIndex[id]; name != "" {
				data.GenreName = name
			}
		}
	}
	if data.Mode == "genre" && data.GenreID == "" && data.GenreName != "" {
		for _, genre := range genres {
			if strings.EqualFold(strings.TrimSpace(genre.Name), strings.TrimSpace(data.GenreName)) {
				data.GenreID = strconv.FormatInt(genre.ID, 10)
				data.GenreName = genre.Name
				break
			}
		}
	}
	if data.YearGenreID != "" {
		if id, parseErr := strconv.ParseInt(data.YearGenreID, 10, 64); parseErr == nil {
			if name := genreIndex[id]; name != "" {
				data.YearGenreName = name
			}
		}
	}
	if data.Mode == "year" && data.YearGenreID == "" && data.YearGenreName != "" {
		for _, genre := range genres {
			if strings.EqualFold(strings.TrimSpace(genre.Name), strings.TrimSpace(data.YearGenreName)) {
				data.YearGenreID = strconv.FormatInt(genre.ID, 10)
				data.YearGenreName = genre.Name
				break
			}
		}
	}

	if err := searchLoadPageContent(client, &data, genres, genreIndex); err != nil {
		fmt.Println("[SEARCH PAGE DATA ERROR]", err)
		data.ErrorMessage = "We couldn't retrieve search results right now. Please try again shortly."
	}

	searchEnsureHeroBackdrops(client, &data, genreIndex)
	searchFinishPageData(&data)
	searchRenderPage(w, data)
}

// SearchSuggestionsHandler returns live title, genre, and keyword suggestions.
// Register this handler at /api/search/suggestions.
func SearchSuggestionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		searchWriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := searchTrimLimit(r.URL.Query().Get("q"), 80)
	mode := searchNormalizeMode(r.URL.Query().Get("mode"))
	media := searchNormalizeMedia(r.URL.Query().Get("media"))
	if len([]rune(query)) < 2 {
		searchWriteJSON(w, map[string]interface{}{"success": true, "suggestions": []searchPageSuggestion{}})
		return
	}

	client, err := newMovieTMDBClient()
	if err != nil {
		fmt.Println("[SEARCH SUGGESTION CLIENT ERROR]", err)
		searchWriteJSONError(w, "Search suggestions are temporarily unavailable", http.StatusBadGateway)
		return
	}

	suggestions := make([]searchPageSuggestion, 0, searchSuggestionLimit)
	switch mode {
	case "genre":
		genres, genreErr := searchLoadGenres(client)
		if genreErr != nil && len(genres) == 0 {
			genres = searchDefaultGenres()
		}
		lowerQuery := strings.ToLower(query)
		for _, genre := range genres {
			if strings.Contains(strings.ToLower(genre.Name), lowerQuery) {
				suggestions = append(suggestions, searchPageSuggestion{ID: genre.ID, Name: genre.Name, Type: "genre"})
				if len(suggestions) >= searchSuggestionLimit {
					break
				}
			}
		}

	case "keyword":
		response, keywordErr := client.GetSearchKeywords(query, map[string]string{
			"language": "en-US",
			"page":     "1",
		})
		if keywordErr != nil {
			fmt.Println("[SEARCH KEYWORD SUGGESTION ERROR]", keywordErr)
			searchWriteJSONError(w, "Keyword suggestions are temporarily unavailable", http.StatusBadGateway)
			return
		}
		if response != nil && response.SearchKeywordsResults != nil {
			for _, item := range response.SearchKeywordsResults.Results {
				if item == nil || item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
					continue
				}
				suggestions = append(suggestions, searchPageSuggestion{ID: item.ID, Name: strings.TrimSpace(item.Name), Type: "keyword"})
				if len(suggestions) >= searchSuggestionLimit {
					break
				}
			}
		}

	default: // Title autocomplete searches both movies and television.
		options := map[string]string{"language": "en-US", "page": "1", "include_adult": "false"}
		if media != "tv" {
			response, movieErr := client.GetSearchMovies(query, options)
			if movieErr != nil {
				fmt.Println("[SEARCH MOVIE SUGGESTION ERROR]", movieErr)
			} else if response != nil && response.SearchMoviesResults != nil {
				for _, item := range response.SearchMoviesResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Title) == "" {
						continue
					}
					suggestions = append(suggestions, searchPageSuggestion{
						ID: item.ID, Name: strings.TrimSpace(item.Title), Type: "movie",
						Year: formatYear(item.ReleaseDate), PosterURL: imageURL(item.PosterPath, tmdb.W185), Rating: item.VoteAverage,
					})
				}
			}
		}
		if media != "movie" {
			response, tvErr := client.GetSearchTVShow(query, options)
			if tvErr != nil {
				fmt.Println("[SEARCH TV SUGGESTION ERROR]", tvErr)
			} else if response != nil && response.SearchTVShowsResults != nil {
				for _, item := range response.SearchTVShowsResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
						continue
					}
					suggestions = append(suggestions, searchPageSuggestion{
						ID: item.ID, Name: strings.TrimSpace(item.Name), Type: "tv",
						Year: formatYear(item.FirstAirDate), PosterURL: imageURL(item.PosterPath, tmdb.W185), Rating: item.VoteAverage,
					})
				}
			}
		}
		sort.SliceStable(suggestions, func(i, j int) bool {
			return suggestions[i].Rating > suggestions[j].Rating
		})
		if len(suggestions) > searchSuggestionLimit {
			suggestions = suggestions[:searchSuggestionLimit]
		}
	}

	searchWriteJSON(w, map[string]interface{}{"success": true, "suggestions": suggestions})
}

func newSearchPageData(values url.Values) SearchPageData {
	mode := searchNormalizeMode(values.Get("mode"))
	media := searchNormalizeMedia(values.Get("media"))
	page, _ := strconv.Atoi(values.Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 500 {
		page = 500
	}

	data := SearchPageData{
		Mode:            mode,
		MediaFilter:     media,
		Query:           searchTrimLimit(values.Get("q"), 100),
		GenreID:         searchPositiveID(values.Get("genre_id")),
		GenreName:       searchTrimLimit(values.Get("genre"), 80),
		Year:            searchYearValue(values.Get("year")),
		TitleYear:       searchYearValue(values.Get("title_year")),
		YearGenreID:     searchPositiveID(values.Get("year_genre_id")),
		YearGenreName:   searchTrimLimit(values.Get("year_genre"), 80),
		HeroBackdrops:   make([]string, 0, 5),
		Keyword:         searchTrimLimit(values.Get("keyword"), 100),
		KeywordID:       searchPositiveID(values.Get("keyword_id")),
		Page:            page,
		Results:         make([]SearchPageCard, 0, searchPageResultLimit),
		Recommendations: make([]SearchPageCard, 0, 12),
		KeywordPills:    make([]SearchPageKeyword, 0, searchKeywordLimit),
		YearOptions:     searchYearOptions(),
	}
	data.IsLanding = mode == "title" && data.Query == ""
	data.HasActiveSearch = (mode == "title" && data.Query != "") ||
		(mode == "genre" && (data.GenreID != "" || data.GenreName != "")) ||
		(mode == "year" && data.Year != "") ||
		(mode == "keyword" && (data.KeywordID != "" || data.Keyword != ""))
	return data
}

func searchLoadPageContent(client *tmdb.Client, data *SearchPageData, genres []SearchPageGenre, genreIndex map[int64]string) error {
	if data.Mode == "genre" && data.GenreID == "" && data.GenreName != "" {
		for _, genre := range genres {
			if strings.EqualFold(strings.TrimSpace(genre.Name), strings.TrimSpace(data.GenreName)) {
				data.GenreID = strconv.FormatInt(genre.ID, 10)
				data.GenreName = genre.Name
				break
			}
		}
	}

	if data.Mode == "keyword" && data.KeywordID == "" && data.Keyword != "" {
		id, name, err := searchResolveKeyword(client, data.Keyword, 0)
		if err != nil {
			return err
		}
		if id == 0 {
			data.ErrorMessage = "We couldn't match that phrase to a TMDB keyword. Choose one of the suggestions or try another term."
			return nil
		}
		data.KeywordID = strconv.FormatInt(id, 10)
		if name != "" {
			data.Keyword = name
		}
	}

	if data.Mode == "title" && data.Query == "" {
		return searchLoadLanding(client, data, genreIndex)
	}
	if data.Mode == "year" && data.Year == "" {
		data.ErrorMessage = "Choose a year first. You can optionally narrow the results by genre."
		return nil
	}
	if data.Mode == "year" && data.YearGenreName != "" && data.YearGenreID == "" {
		data.ErrorMessage = "Choose a genre from the suggestions, or clear the optional genre filter."
		return nil
	}
	if !data.HasActiveSearch {
		return nil
	}
	if data.Mode == "genre" && data.GenreID == "" {
		data.ErrorMessage = "Choose a genre from the suggestions so we can find matching titles."
		return nil
	}
	if data.Mode == "keyword" && data.KeywordID == "" {
		data.ErrorMessage = "Choose a keyword suggestion so MoviPilot can find titles with that theme."
		return nil
	}

	var err error
	switch data.Mode {
	case "title":
		err = searchLoadTitleResults(client, data, genreIndex)
	case "genre", "year", "keyword":
		err = searchLoadDiscoverResults(client, data, genreIndex, "popularity.desc", data.Page, &data.Results, &data.TotalResults, &data.TotalPages)
	}
	if err != nil {
		return err
	}

	searchSortCards(data.Results)
	searchLoadRelatedRecommendations(client, data, genreIndex)
	searchLoadResultKeywords(client, data)
	return nil
}

func searchLoadLanding(client *tmdb.Client, data *SearchPageData, genreIndex map[int64]string) error {
	data.Heading = "Popular right now"
	data.Subheading = "A few stories making waves across movies and television."
	var total int64
	pages := 1
	if err := searchLoadDiscoverResults(client, data, genreIndex, "popularity.desc", 1, &data.Results, &total, &pages); err != nil {
		return err
	}
	data.TotalResults = total
	data.TotalPages = 1

	var recTotal int64
	var recPages int
	if err := searchLoadDiscoverResults(client, data, genreIndex, "vote_average.desc", 1, &data.Recommendations, &recTotal, &recPages); err != nil {
		// Popular results should still render if the optional recommendation rail fails.
		fmt.Println("[SEARCH LANDING RECOMMENDATIONS ERROR]", err)
	}
	data.Recommendations = searchLimitUniqueCards(data.Recommendations, data.Results, 12)
	return nil
}

func searchLoadTitleResults(client *tmdb.Client, data *SearchPageData, genreIndex map[int64]string) error {
	options := map[string]string{
		"language":      "en-US",
		"page":          strconv.Itoa(data.Page),
		"include_adult": "false",
	}
	if data.TitleYear != "" {
		if data.MediaFilter != "tv" {
			options["year"] = data.TitleYear
		}
	}
	if data.MediaFilter != "tv" {
		response, err := client.GetSearchMovies(data.Query, options)
		if err != nil {
			return fmt.Errorf("search movies: %w", err)
		}
		if response != nil {
			data.TotalResults += response.TotalResults
			if int(response.TotalPages) > data.TotalPages {
				data.TotalPages = int(response.TotalPages)
			}
			if response.SearchMoviesResults != nil {
				for _, item := range response.SearchMoviesResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Title) == "" {
						continue
					}
					data.Results = append(data.Results, SearchPageCard{
						ID: item.ID, MediaType: "movie", Title: strings.TrimSpace(item.Title), OriginalTitle: strings.TrimSpace(item.OriginalTitle),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.ReleaseDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
				}
			}
		}
	}
	if data.MediaFilter != "movie" {
		tvOptions := map[string]string{"language": "en-US", "page": strconv.Itoa(data.Page), "include_adult": "false"}
		if data.TitleYear != "" {
			tvOptions["first_air_date_year"] = data.TitleYear
		}
		response, err := client.GetSearchTVShow(data.Query, tvOptions)
		if err != nil {
			return fmt.Errorf("search television: %w", err)
		}
		if response != nil {
			data.TotalResults += response.TotalResults
			if int(response.TotalPages) > data.TotalPages {
				data.TotalPages = int(response.TotalPages)
			}
			if response.SearchTVShowsResults != nil {
				for _, item := range response.SearchTVShowsResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
						continue
					}
					data.Results = append(data.Results, SearchPageCard{
						ID: item.ID, MediaType: "tv", Title: strings.TrimSpace(item.Name), OriginalTitle: strings.TrimSpace(item.OriginalName),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.FirstAirDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
				}
			}
		}
	}
	if data.TotalPages < 1 {
		data.TotalPages = 1
	}
	if data.Mode == "title" && data.TitleYear != "" {
		data.Year = data.TitleYear
	}
	return nil
}

func searchLoadDiscoverResults(client *tmdb.Client, data *SearchPageData, genreIndex map[int64]string, sortBy string, page int, target *[]SearchPageCard, total *int64, totalPages *int) error {
	options := map[string]string{
		"language":      "en-US",
		"page":          strconv.Itoa(page),
		"sort_by":       sortBy,
		"include_adult": "false",
	}
	if sortBy == "vote_average.desc" {
		// Avoid treating a tiny handful of ratings as the strongest recommendation.
		options["vote_count.gte"] = "250"
	}

	includeMovies := data.MediaFilter != "tv"
	includeTV := data.MediaFilter != "movie"
	movieGenreFilter := ""
	tvGenreFilter := ""
	useGenreFilter := data.Mode == "genre" || (data.Mode == "year" && (data.YearGenreID != "" || data.YearGenreName != ""))
	genreName, genreID := data.GenreName, data.GenreID
	if data.Mode == "year" {
		genreName, genreID = data.YearGenreName, data.YearGenreID
	}
	if useGenreFilter {
		movieGenreFilter = searchGenreDiscoverIDs(genreName, genreID, "movie")
		tvGenreFilter = searchGenreDiscoverIDs(genreName, genreID, "tv")
		if movieGenreFilter == "" {
			includeMovies = false
		}
		if tvGenreFilter == "" {
			includeTV = false
		}
	}

	switch data.Mode {
	case "genre":
		// Movie and television genre IDs are not always the same in TMDB.
		// Their filters are assigned separately below for cross-media search.
	case "year":
		if data.Year == "" {
			return nil
		}
		options["primary_release_date.gte"] = data.Year + "-01-01"
		options["primary_release_date.lte"] = data.Year + "-12-31"
	case "keyword":
		if data.KeywordID == "" {
			return nil
		}
		options["with_keywords"] = data.KeywordID
	}

	if includeMovies {
		movieOptions := make(map[string]string, len(options)+1)
		for key, value := range options {
			movieOptions[key] = value
		}
		if useGenreFilter {
			movieOptions["with_genres"] = movieGenreFilter
		}
		response, err := client.GetDiscoverMovie(movieOptions)
		if err != nil {
			return fmt.Errorf("discover movies: %w", err)
		}
		if response != nil {
			*total += response.TotalResults
			if int(response.TotalPages) > *totalPages {
				*totalPages = int(response.TotalPages)
			}
			if response.DiscoverMovieResults != nil {
				for _, item := range response.DiscoverMovieResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Title) == "" {
						continue
					}
					*target = append(*target, SearchPageCard{
						ID: item.ID, MediaType: "movie", Title: strings.TrimSpace(item.Title), OriginalTitle: strings.TrimSpace(item.OriginalTitle),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.ReleaseDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
				}
			}
		}
	}

	if includeTV {
		tvOptions := make(map[string]string, len(options)+1)
		for key, value := range options {
			tvOptions[key] = value
		}
		delete(tvOptions, "primary_release_date.gte")
		delete(tvOptions, "primary_release_date.lte")
		if useGenreFilter {
			tvOptions["with_genres"] = tvGenreFilter
		}
		if data.Mode == "year" && data.Year != "" {
			tvOptions["first_air_date.gte"] = data.Year + "-01-01"
			tvOptions["first_air_date.lte"] = data.Year + "-12-31"
		}
		response, err := client.GetDiscoverTV(tvOptions)
		if err != nil {
			return fmt.Errorf("discover series: %w", err)
		}
		if response != nil {
			*total += response.TotalResults
			if int(response.TotalPages) > *totalPages {
				*totalPages = int(response.TotalPages)
			}
			if response.DiscoverTVResults != nil {
				for _, item := range response.DiscoverTVResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
						continue
					}
					*target = append(*target, SearchPageCard{
						ID: item.ID, MediaType: "tv", Title: strings.TrimSpace(item.Name), OriginalTitle: strings.TrimSpace(item.OriginalName),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.FirstAirDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
				}
			}
		}
	}

	if *totalPages < 1 {
		*totalPages = 1
	}
	searchSortCards(*target)
	return nil
}

// searchGenreDiscoverIDs translates the selected genre into the ID(s) expected
// by a particular TMDB catalogue. The movie and TV genre dictionaries overlap,
// but some categories use different IDs or names.
func searchGenreDiscoverIDs(name, fallbackID, mediaType string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	name = strings.Join(strings.Fields(name), " ")
	if mediaType == "movie" {
		switch name {
		case "action":
			return "28"
		case "adventure":
			return "12"
		case "action & adventure":
			return "28|12"
		case "animation":
			return "16"
		case "comedy":
			return "35"
		case "crime":
			return "80"
		case "documentary":
			return "99"
		case "drama":
			return "18"
		case "family":
			return "10751"
		case "fantasy":
			return "14"
		case "sci-fi & fantasy":
			return "878|14"
		case "science fiction", "sci-fi":
			return "878"
		case "history":
			return "36"
		case "horror":
			return "27"
		case "music":
			return "10402"
		case "mystery":
			return "9648"
		case "romance":
			return "10749"
		case "tv movie":
			return "10770"
		case "thriller":
			return "53"
		case "war":
			return "10752"
		case "war & politics":
			return "10752"
		case "western":
			return "37"
		case "kids":
			return "10751"
		}
	} else if mediaType == "tv" {
		switch name {
		case "action", "adventure", "action & adventure":
			return "10759"
		case "animation":
			return "16"
		case "comedy":
			return "35"
		case "crime":
			return "80"
		case "documentary":
			return "99"
		case "drama":
			return "18"
		case "family", "kids":
			return "10762"
		case "fantasy", "science fiction", "sci-fi", "sci-fi & fantasy":
			return "10765"
		case "mystery":
			return "9648"
		case "news":
			return "10763"
		case "reality":
			return "10764"
		case "soap":
			return "10766"
		case "talk", "music":
			return "10767"
		case "war", "war & politics":
			return "10768"
		case "western":
			return "37"
		}
	}

	id, err := strconv.ParseInt(strings.TrimSpace(fallbackID), 10, 64)
	if err != nil || id <= 0 {
		return ""
	}
	// Fall back only when the requested ID belongs to that catalogue. This keeps
	// a TV-only genre ID from accidentally being passed to movie discovery.
	movieIDs := map[int64]bool{12: true, 14: true, 16: true, 18: true, 27: true, 28: true, 35: true, 36: true, 37: true, 53: true, 80: true, 99: true, 878: true, 9648: true, 10402: true, 10749: true, 10751: true, 10752: true, 10770: true}
	tvIDs := map[int64]bool{16: true, 18: true, 35: true, 37: true, 80: true, 99: true, 9648: true, 10759: true, 10762: true, 10763: true, 10764: true, 10765: true, 10766: true, 10767: true, 10768: true}
	if mediaType == "movie" && movieIDs[id] {
		return strconv.FormatInt(id, 10)
	}
	if mediaType == "tv" && tvIDs[id] {
		return strconv.FormatInt(id, 10)
	}
	return ""
}

func searchLoadRelatedRecommendations(client *tmdb.Client, data *SearchPageData, genreIndex map[int64]string) {
	if len(data.Results) > 0 {
		seed := data.Results[0]
		options := map[string]string{"language": "en-US", "page": "1"}
		switch seed.MediaType {
		case "movie":
			response, err := client.GetMovieRecommendations(seed.ID, options)
			if err == nil && response != nil && response.MovieRecommendationsResults != nil {
				for _, item := range response.MovieRecommendationsResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Title) == "" {
						continue
					}
					data.Recommendations = append(data.Recommendations, SearchPageCard{
						ID: item.ID, MediaType: "movie", Title: strings.TrimSpace(item.Title), OriginalTitle: strings.TrimSpace(item.OriginalTitle),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.ReleaseDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
					if len(data.Recommendations) >= 16 {
						break
					}
				}
			} else if err != nil {
				fmt.Println("[SEARCH MOVIE RECOMMENDATIONS ERROR]", err)
			}
		case "tv":
			response, err := client.GetTVRecommendations(seed.ID, options)
			if err == nil && response != nil && response.TVRecommendationsResults != nil {
				for _, item := range response.TVRecommendationsResults.Results {
					if item == nil || item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
						continue
					}
					data.Recommendations = append(data.Recommendations, SearchPageCard{
						ID: item.ID, MediaType: "tv", Title: strings.TrimSpace(item.Name), OriginalTitle: strings.TrimSpace(item.OriginalName),
						Overview: strings.TrimSpace(item.Overview), PosterURL: imageURL(item.PosterPath, tmdb.W342), BackdropURL: imageURL(item.BackdropPath, tmdb.W780),
						Year: formatYear(item.FirstAirDate), Rating: item.VoteAverage, VoteCount: item.VoteCount, Popularity: item.Popularity,
						GenreLabels: searchGenreNames(item.GenreIDs, genreIndex),
					})
					if len(data.Recommendations) >= 16 {
						break
					}
				}
			} else if err != nil {
				fmt.Println("[SEARCH TV RECOMMENDATIONS ERROR]", err)
			}
		}
	}

	data.Recommendations = searchLimitUniqueCards(data.Recommendations, data.Results, 12)
	if len(data.Recommendations) > 0 || data.IsLanding {
		return
	}

	// If TMDB has no direct recommendation set, use a second discovery pass.
	// For title searches, seed that fallback with the first result's genre so it
	// remains related instead of turning into an unrelated popular-title shelf.
	fallbackData := *data
	if data.Mode == "title" && len(data.Results) > 0 {
		seed := data.Results[0]
		if len(seed.GenreLabels) > 0 {
			fallbackData.Mode = "genre"
			fallbackData.GenreName = seed.GenreLabels[0]
			fallbackData.MediaFilter = seed.MediaType
			fallbackData.GenreID = ""
		}
	}
	var total int64
	var totalPages int
	fallback := make([]SearchPageCard, 0, 40)
	if err := searchLoadDiscoverResults(client, &fallbackData, genreIndex, "popularity.desc", 1, &fallback, &total, &totalPages); err == nil {
		data.Recommendations = searchLimitUniqueCards(fallback, data.Results, 12)
	}
}

func searchLoadResultKeywords(client *tmdb.Client, data *SearchPageData) {
	if len(data.Results) > 0 {
		seed := data.Results[0]
		seen := make(map[int64]struct{})
		appendKeyword := func(id int64, name string) {
			name = strings.TrimSpace(name)
			if id <= 0 || name == "" {
				return
			}
			if _, exists := seen[id]; exists {
				return
			}
			seen[id] = struct{}{}
			data.KeywordPills = append(data.KeywordPills, SearchPageKeyword{ID: id, Name: name})
		}

		if seed.MediaType == "movie" {
			response, err := client.GetMovieKeywords(seed.ID)
			if err == nil && response != nil {
				for _, keyword := range response.Keywords {
					if keyword != nil {
						appendKeyword(keyword.ID, keyword.Name)
					}
					if len(data.KeywordPills) >= searchKeywordLimit {
						break
					}
				}
			} else if err != nil {
				fmt.Println("[SEARCH MOVIE KEYWORDS ERROR]", err)
			}
		} else if seed.MediaType == "tv" {
			response, err := client.GetTVKeywords(seed.ID)
			if err == nil && response != nil && response.TVKeywordsResults != nil {
				for _, keyword := range response.TVKeywordsResults.Results {
					if keyword != nil {
						appendKeyword(keyword.ID, keyword.Name)
					}
					if len(data.KeywordPills) >= searchKeywordLimit {
						break
					}
				}
			} else if err != nil {
				fmt.Println("[SEARCH TV KEYWORDS ERROR]", err)
			}
		}
	}

	if data.Mode == "keyword" && data.KeywordID != "" {
		id, _ := strconv.ParseInt(data.KeywordID, 10, 64)
		present := false
		for _, keyword := range data.KeywordPills {
			if keyword.ID == id {
				present = true
				break
			}
		}
		if !present {
			data.KeywordPills = append([]SearchPageKeyword{{ID: id, Name: data.Keyword}}, data.KeywordPills...)
		}
	}
}

func searchResolveKeyword(client *tmdb.Client, query string, selectedID int64) (int64, string, error) {
	if selectedID > 0 {
		return selectedID, strings.TrimSpace(query), nil
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return 0, "", nil
	}
	response, err := client.GetSearchKeywords(query, map[string]string{"language": "en-US", "page": "1"})
	if err != nil {
		return 0, "", fmt.Errorf("resolve keyword: %w", err)
	}
	if response == nil || response.SearchKeywordsResults == nil {
		return 0, "", nil
	}
	var firstID int64
	var firstName string
	for _, result := range response.SearchKeywordsResults.Results {
		if result == nil || result.ID <= 0 || strings.TrimSpace(result.Name) == "" {
			continue
		}
		if firstID == 0 {
			firstID, firstName = result.ID, strings.TrimSpace(result.Name)
		}
		if strings.EqualFold(strings.TrimSpace(result.Name), query) {
			return result.ID, strings.TrimSpace(result.Name), nil
		}
	}
	// For manually entered text, require a reasonably close phrase rather than
	// silently searching an unrelated keyword result.
	if firstID > 0 && (strings.Contains(strings.ToLower(firstName), strings.ToLower(query)) || strings.Contains(strings.ToLower(query), strings.ToLower(firstName))) {
		return firstID, firstName, nil
	}
	return 0, "", nil
}

func searchLoadGenres(client *tmdb.Client) ([]SearchPageGenre, error) {
	searchGenresCache.RLock()
	if len(searchGenresCache.Genres) > 0 && time.Now().Before(searchGenresCache.ExpiresAt) {
		cached := append([]SearchPageGenre(nil), searchGenresCache.Genres...)
		searchGenresCache.RUnlock()
		return cached, nil
	}
	searchGenresCache.RUnlock()

	movieList, movieErr := client.GetGenreMovieList(map[string]string{"language": "en-US"})
	tvList, tvErr := client.GetGenreTVList(map[string]string{"language": "en-US"})
	if movieErr != nil && tvErr != nil {
		return nil, fmt.Errorf("load TMDB genres: movies: %v; TV: %w", movieErr, tvErr)
	}

	genres := make([]SearchPageGenre, 0, 40)
	seen := make(map[int64]struct{}, 40)
	appendGenre := func(id int64, name string) {
		name = strings.TrimSpace(name)
		if id <= 0 || name == "" {
			return
		}
		if _, exists := seen[id]; exists {
			return
		}
		seen[id] = struct{}{}
		genres = append(genres, SearchPageGenre{ID: id, Name: name})
	}
	if movieList != nil {
		for _, genre := range movieList.Genres {
			if genre != nil {
				appendGenre(genre.ID, genre.Name)
			}
		}
	}
	if tvList != nil {
		for _, genre := range tvList.Genres {
			if genre != nil {
				appendGenre(genre.ID, genre.Name)
			}
		}
	}
	sort.Slice(genres, func(i, j int) bool { return strings.ToLower(genres[i].Name) < strings.ToLower(genres[j].Name) })
	if len(genres) == 0 {
		return nil, fmt.Errorf("TMDB returned an empty genre list")
	}

	searchGenresCache.Lock()
	searchGenresCache.Genres = append([]SearchPageGenre(nil), genres...)
	searchGenresCache.ExpiresAt = time.Now().Add(6 * time.Hour)
	searchGenresCache.Unlock()
	return genres, nil
}

func searchDefaultGenres() []SearchPageGenre {
	return []SearchPageGenre{
		{ID: 28, Name: "Action"}, {ID: 12, Name: "Adventure"}, {ID: 16, Name: "Animation"},
		{ID: 35, Name: "Comedy"}, {ID: 80, Name: "Crime"}, {ID: 99, Name: "Documentary"},
		{ID: 18, Name: "Drama"}, {ID: 10751, Name: "Family"}, {ID: 14, Name: "Fantasy"},
		{ID: 36, Name: "History"}, {ID: 27, Name: "Horror"}, {ID: 9648, Name: "Mystery"},
		{ID: 10749, Name: "Romance"}, {ID: 878, Name: "Science Fiction"}, {ID: 53, Name: "Thriller"},
		{ID: 10759, Name: "Action & Adventure"}, {ID: 10762, Name: "Kids"}, {ID: 10765, Name: "Sci-Fi & Fantasy"},
	}
}

func searchBuildGenreIndex(genres []SearchPageGenre) map[int64]string {
	index := make(map[int64]string, len(genres))
	for _, genre := range genres {
		index[genre.ID] = genre.Name
	}
	return index
}

func searchGenreNames(ids []int64, genreIndex map[int64]string) []string {
	out := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		name := genreIndex[id]
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func searchSortCards(cards []SearchPageCard) {
	sort.SliceStable(cards, func(i, j int) bool {
		if cards[i].Popularity != cards[j].Popularity {
			return cards[i].Popularity > cards[j].Popularity
		}
		if cards[i].Rating != cards[j].Rating {
			return cards[i].Rating > cards[j].Rating
		}
		return cards[i].Title < cards[j].Title
	})
}

func searchLimitUniqueCards(candidates, exclude []SearchPageCard, limit int) []SearchPageCard {
	seen := make(map[string]struct{}, len(exclude)+len(candidates))
	for _, card := range exclude {
		seen[card.MediaType+":"+strconv.FormatInt(card.ID, 10)] = struct{}{}
	}
	out := make([]SearchPageCard, 0, limit)
	for _, card := range candidates {
		key := card.MediaType + ":" + strconv.FormatInt(card.ID, 10)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, card)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// searchEnsureHeroBackdrops prioritizes weekly trending movie backdrops from TMDB,
// then fills any gaps with popularity-sorted discovery images and current results.
// The trending list is cached to avoid repeating requests on each Search page visit.
func searchEnsureHeroBackdrops(client *tmdb.Client, data *SearchPageData, genreIndex map[int64]string) {
	searchBuildHeroBackdrops(data)
	activeBackdrops := append([]string(nil), data.HeroBackdrops...)
	data.HeroBackdrops = make([]string, 0, 5)

	appendBackdrop := func(raw string) {
		raw = searchHeroBackdropURL(raw)
		if raw == "" || len(data.HeroBackdrops) >= 5 {
			return
		}
		for _, existing := range data.HeroBackdrops {
			if existing == raw {
				return
			}
		}
		data.HeroBackdrops = append(data.HeroBackdrops, raw)
	}

	searchHeroBackdropsCache.RLock()
	cached := append([]string(nil), searchHeroBackdropsCache.Backdrops...)
	cacheValid := len(cached) > 0 && time.Now().Before(searchHeroBackdropsCache.ExpiresAt)
	searchHeroBackdropsCache.RUnlock()

	if !cacheValid {
		// GetTrending supports movie + week and returns actual backdrop paths.
		// A discovery fallback is used only if TMDB does not return enough images.
		trendingBackdrops := make([]string, 0, 5)
		seen := make(map[string]struct{}, 8)
		trending, err := client.GetTrending("movie", "week")
		if err != nil {
			fmt.Println("[SEARCH HERO TRENDING ERROR]", err)
		} else if trending != nil && trending.TrendingResults != nil {
			for _, item := range trending.TrendingResults.Results {
				if item == nil || strings.TrimSpace(item.BackdropPath) == "" {
					continue
				}
				backdrop := searchHeroBackdropURL(imageURL(item.BackdropPath, tmdb.W780))
				if backdrop == "" {
					continue
				}
				if _, exists := seen[backdrop]; exists {
					continue
				}
				seen[backdrop] = struct{}{}
				trendingBackdrops = append(trendingBackdrops, backdrop)
				if len(trendingBackdrops) >= 5 {
					break
				}
			}
		}

		if len(trendingBackdrops) < 3 {
			fallbackData := SearchPageData{Mode: "title", MediaFilter: "all"}
			fallbackCards := make([]SearchPageCard, 0, 40)
			var total int64
			pages := 1
			if err := searchLoadDiscoverResults(client, &fallbackData, genreIndex, "popularity.desc", 1, &fallbackCards, &total, &pages); err != nil {
				fmt.Println("[SEARCH HERO DISCOVERY BACKDROP ERROR]", err)
			} else {
				for _, card := range fallbackCards {
					backdrop := searchHeroBackdropURL(card.BackdropURL)
					if backdrop == "" {
						continue
					}
					if _, exists := seen[backdrop]; exists {
						continue
					}
					seen[backdrop] = struct{}{}
					trendingBackdrops = append(trendingBackdrops, backdrop)
					if len(trendingBackdrops) >= 5 {
						break
					}
				}
			}
		}

		if len(trendingBackdrops) > 0 {
			cached = append([]string(nil), trendingBackdrops...)
			searchHeroBackdropsCache.Lock()
			searchHeroBackdropsCache.Backdrops = append([]string(nil), trendingBackdrops...)
			searchHeroBackdropsCache.ExpiresAt = time.Now().Add(6 * time.Hour)
			searchHeroBackdropsCache.Unlock()
		}
	}

	for _, backdrop := range cached {
		appendBackdrop(backdrop)
	}
	for _, backdrop := range activeBackdrops {
		appendBackdrop(backdrop)
	}
}

// searchBuildHeroBackdrops gathers unique landscape images returned by the
// active results/recommendations as a fallback if the trending endpoint is empty.
func searchBuildHeroBackdrops(data *SearchPageData) {
	data.HeroBackdrops = make([]string, 0, 5)
	seen := make(map[string]struct{}, 8)
	appendBackdrop := func(raw string) {
		raw = searchHeroBackdropURL(raw)
		if raw == "" {
			return
		}
		if _, exists := seen[raw]; exists {
			return
		}
		seen[raw] = struct{}{}
		data.HeroBackdrops = append(data.HeroBackdrops, raw)
	}
	for _, card := range data.Results {
		appendBackdrop(card.BackdropURL)
		if len(data.HeroBackdrops) >= 5 {
			return
		}
	}
	for _, card := range data.Recommendations {
		appendBackdrop(card.BackdropURL)
		if len(data.HeroBackdrops) >= 5 {
			return
		}
	}
}

func searchHeroBackdropURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	return strings.Replace(raw, "/w780/", "/w1280/", 1)
}

func searchFinishPageData(data *SearchPageData) {
	if data.TotalPages < 1 {
		data.TotalPages = 1
	}
	if data.Page > data.TotalPages {
		data.Page = data.TotalPages
	}
	data.HasPrevious = data.Page > 1
	data.HasNext = data.Page < data.TotalPages
	data.PreviousPage = data.Page - 1
	data.NextPage = data.Page + 1

	switch data.Mode {
	case "genre":
		name := data.GenreName
		if name == "" {
			name = "your chosen genre"
		}
		data.Heading = "Explore " + name
		data.Subheading = "A curated mix of films and series connected to this genre."
	case "year":
		if data.Year != "" {
			data.Heading = "Stories from " + data.Year
			if year, err := strconv.Atoi(data.Year); err == nil && year > time.Now().Year() {
				data.Subheading = "Discover announced films and series scheduled for this future year. Listings depend on what TMDB currently knows."
			} else {
				data.Subheading = "Explore movies and television series released or first aired in this year."
			}
			if data.YearGenreName != "" {
				data.Subheading += " Filtered by " + data.YearGenreName + "."
			}
		} else {
			data.Heading = "Travel through the years"
			data.Subheading = "Choose a year to discover movies and series from that moment in cinema."
		}
	case "keyword":
		name := data.Keyword
		if name == "" {
			name = "a theme"
		}
		data.Heading = "Explore the theme: " + name
		data.Subheading = "Find films and series carrying this keyword in TMDB's catalogue."
	default:
		if data.Query != "" {
			data.Heading = "Search results for “" + data.Query + "”"
			data.Subheading = "Movies and series matched to your search, with more stories to discover below."
		} else if data.Heading == "" {
			data.Heading = "Popular right now"
			data.Subheading = "A few stories making waves across movies and television."
		}
	}
	if data.MediaFilter == "movie" {
		data.Subheading += " Showing movies only."
	} else if data.MediaFilter == "tv" {
		data.Subheading += " Showing series only."
	}
}

func searchYearOptions() []int {
	current := time.Now().Year()
	out := make([]int, 0, 96)
	for year := current + 15; year >= current-80; year-- {
		out = append(out, year)
	}
	return out
}

func searchNormalizeMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "genre", "year", "keyword":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "title"
	}
}

func searchNormalizeMedia(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "movie", "tv":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "all"
	}
}

func searchYearValue(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	year, err := strconv.Atoi(raw)
	if err != nil || year < 1000 || year > 9999 {
		return ""
	}
	return strconv.Itoa(year)
}

func searchPositiveID(raw string) string {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return ""
	}
	return strconv.FormatInt(id, 10)
}

func searchTrimLimit(raw string, limit int) string {
	raw = strings.TrimSpace(raw)
	runes := []rune(raw)
	if len(runes) > limit {
		raw = string(runes[:limit])
	}
	return strings.TrimSpace(raw)
}

func searchRenderPage(w http.ResponseWriter, data SearchPageData) {
	tmpl, err := template.ParseFiles("templates/search_page.html")
	if err != nil {
		fmt.Println("[SEARCH TEMPLATE PARSE ERROR]", err)
		http.Error(w, "Could not load Search page", http.StatusInternalServerError)
		return
	}
	var buffer bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buffer, "search_page", data); err != nil {
		fmt.Println("[SEARCH TEMPLATE EXECUTION ERROR]", err)
		http.Error(w, "Could not render Search page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(buffer.Bytes()); err != nil {
		fmt.Println("[SEARCH RESPONSE ERROR]", err)
	}
}

func searchWriteJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func searchWriteJSONError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": message})
}
