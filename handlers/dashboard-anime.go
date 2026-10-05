package handlers

import (
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/benlei/go-tmdb/v2"
)

/* =========================================================
   ANIME CONSTANTS
   ========================================================= */

const (
	// Final number of cards displayed.
	animeDisplayLimit = 60

	// TMDB pages fetched for each media type.
	animeCandidatePages = 3

	// Maximum candidates kept per media type.
	animeMaxCandidatesPerType = 50

	// Number of TV candidates enriched with detail requests.
	animeTVDetailCandidates = 40

	// Preferred movie / TV balance.
	animeMovieTarget = 30
	animeTVTarget    = 30

	// Number of concurrent TV detail requests.
	animeDetailWorkers = 8

	// Cache durations.
	animeListCacheTTL   = 5 * time.Minute
	animeDetailCacheTTL = 30 * time.Minute

	// 2009 and earlier = Old Gen.
	animeOldGenCutoff = "2009-12-31"

	// Studio Ghibli TMDB company ID.
	animeGhibliCompanyID = "10342"
)

/* =========================================================
   TEMPLATE DATA
   ========================================================= */

type AnimePageData struct {
	Cards []AnimeCard
}

/* =========================================================
   ANIME CARD
   ========================================================= */

type AnimeCard struct {
	ID          int64
	Title       string
	MediaType   string
	ReleaseYear string
	Genre       string
	Rating      float32
	PosterURL   string
	Seasons     int
	Episodes    int
}

/* =========================================================
   MOVIE SEED
   ========================================================= */

type animeMovieSeed struct {
	ID          int64
	Title       string
	ReleaseDate string
	PosterPath  string
	GenreIDs    []int64
	VoteAverage float32
}

/* =========================================================
   TV SEED
   ========================================================= */

type animeTVSeed struct {
	ID           int64
	Name         string
	FirstAirDate string
	PosterPath   string
	GenreIDs     []int64
	VoteAverage  float32
}

/* =========================================================
   ANIME LIST CACHE
   ========================================================= */

type animeListCacheEntry struct {
	ExpiresAt time.Time
	Cards     []AnimeCard
}

var animeListCache = struct {
	sync.RWMutex
	Items map[string]animeListCacheEntry
}{
	Items: make(map[string]animeListCacheEntry),
}

/* =========================================================
   ANIME TV DETAIL CACHE
   ========================================================= */

type animeTVDetailCacheEntry struct {
	ExpiresAt time.Time
	Details   *tmdb.TVDetails
}

var animeTVDetailCache = struct {
	sync.RWMutex
	Items map[int64]animeTVDetailCacheEntry
}{
	Items: make(map[int64]animeTVDetailCacheEntry),
}

/* =========================================================
   ANIME KEYWORD CACHE
   ========================================================= */

var animeKeywordCache = struct {
	sync.RWMutex
	Items map[string]int64
}{
	Items: make(map[string]int64),
}

/* =========================================================
   ANIME PAGE HANDLER
   ========================================================= */

func AnimePageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"text/html; charset=utf-8",
	)

	tmpl, err := template.ParseFiles(
		"templates/anime_page.html",
	)
	if err != nil {
		http.Error(
			w,
			"Could not load Anime page",
			http.StatusInternalServerError,
		)
		return
	}

	err = tmpl.ExecuteTemplate(
		w,
		"anime_page",
		AnimePageData{},
	)
	if err != nil {
		http.Error(
			w,
			"Could not render Anime page",
			http.StatusInternalServerError,
		)
		return
	}
}

/* =========================================================
   ANIME CARDS HANDLER
   ========================================================= */

func AnimeCardsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	filter := strings.ToLower(
		strings.TrimSpace(
			r.URL.Query().Get("filter"),
		),
	)

	if filter == "" {
		filter = "all"
	}

	if !validAnimeFilter(filter) {
		http.Error(
			w,
			"Invalid Anime filter",
			http.StatusBadRequest,
		)
		return
	}

	/*
		Reuse the same optimized TMDB client
		used by the Movie page.
	*/
	client, err := newMovieTMDBClient()
	if err != nil {
		http.Error(
			w,
			"TMDB is not configured",
			http.StatusInternalServerError,
		)
		return
	}

	cards, err := getAnimeCards(
		client,
		filter,
	)
	if err != nil {
		fmt.Printf(
			"[ANIME DATA ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not load Anime data",
			http.StatusBadGateway,
		)
		return
	}

	tmpl, err := template.ParseFiles(
		"templates/anime_page.html",
	)
	if err != nil {
		fmt.Printf(
			"[ANIME TEMPLATE PARSE ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not load Anime template",
			http.StatusInternalServerError,
		)
		return
	}

	data := AnimePageData{
		Cards: cards,
	}

	var buffer bytes.Buffer

	err = tmpl.ExecuteTemplate(
		&buffer,
		"anime_cards",
		data,
	)
	if err != nil {
		fmt.Printf(
			"[ANIME TEMPLATE EXEC ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not render Anime cards",
			http.StatusInternalServerError,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"text/html; charset=utf-8",
	)

	w.Header().Set(
		"Cache-Control",
		"private, max-age=60, stale-while-revalidate=300",
	)

	_, err = w.Write(buffer.Bytes())
	if err != nil {
		fmt.Printf(
			"[ANIME RESPONSE ERROR] %v\n",
			err,
		)
	}
}

/* =========================================================
   VALID FILTER
   ========================================================= */

func validAnimeFilter(filter string) bool {
	switch filter {
	case
		"all",
		"new",
		"old-gen",
		"upcoming",
		"popular",
		"top-rated",
		"action",
		"romance",
		"adventure",
		"magic",
		"mystery",
		"swordsman",
		"ghibli":

		return true

	default:
		return false
	}
}

/* =========================================================
   MAIN ANIME PIPELINE
   ========================================================= */

func getAnimeCards(
	client *tmdb.Client,
	filter string,
) ([]AnimeCard, error) {

	/*
		=========================================================
		SERVER CACHE
		=========================================================
	*/

	if cached, ok := getCachedAnimeList(filter); ok {
		return cached, nil
	}

	/*
		=========================================================
		FILTER OPTIONS
		=========================================================
	*/

	options, err := getAnimeFilterOptions(
		client,
		filter,
	)
	if err != nil {
		return nil, err
	}

	/*
		=========================================================
		FETCH MOVIES + TV CONCURRENTLY
		=========================================================
	*/

	var waitGroup sync.WaitGroup

	waitGroup.Add(2)

	var movieSeeds []animeMovieSeed
	var tvSeeds []animeTVSeed

	var movieErr error
	var tvErr error

	go func() {
		defer waitGroup.Done()

		movieSeeds, movieErr =
			getAnimeMovieSeeds(
				client,
				options.movieOptions,
			)
	}()

	go func() {
		defer waitGroup.Done()

		tvSeeds, tvErr =
			getAnimeTVSeeds(
				client,
				options.tvOptions,
			)
	}()

	waitGroup.Wait()

	/*
		=========================================================
		PARTIAL FAILURE IS ALLOWED
		=========================================================
	*/

	if movieErr != nil && tvErr != nil {
		return nil, fmt.Errorf(
			"anime movie and TV discovery failed: movie=%v tv=%v",
			movieErr,
			tvErr,
		)
	}

	/*
		=========================================================
		BUILD MOVIE CARDS
		=========================================================
	*/

	movieCards := make(
		[]AnimeCard,
		0,
		len(movieSeeds),
	)

	for _, seed := range movieSeeds {
		title := strings.TrimSpace(seed.Title)

		posterPath := strings.TrimSpace(seed.PosterPath)

		if title == "" || posterPath == "" {
			continue
		}

		movieCards = append(
			movieCards,
			AnimeCard{
				ID: seed.ID,

				Title: title,

				MediaType: "movie",

				ReleaseYear: formatAnimeYear(
					seed.ReleaseDate,
				),

				Genre: animeDisplayGenre(
					filter,
					seed.GenreIDs,
					"movie",
				),

				Rating: seed.VoteAverage,

				PosterURL: tmdb.GetImageURL(
					posterPath,
					tmdb.W185,
				),
			},
		)
	}

	/*
		=========================================================
		BUILD TV CARDS
		=========================================================
	*/

	if len(tvSeeds) > animeTVDetailCandidates {
		tvSeeds = tvSeeds[:animeTVDetailCandidates]
	}

	tvCards := enrichAnimeTVCards(
		client,
		tvSeeds,
		filter,
	)

	/*
		=========================================================
		MIX MOVIES + SERIES
		=========================================================
	*/

	finalCards := mergeAnimeCards(
		movieCards,
		tvCards,
	)

	/*
		=========================================================
		CACHE
		=========================================================
	*/

	saveCachedAnimeList(
		filter,
		finalCards,
	)

	/*
		=========================================================
		DEVELOPMENT LOGGING
		=========================================================
	*/

	if movieErr != nil {
		fmt.Printf(
			"[ANIME MOVIE DISCOVERY WARNING] %v\n",
			movieErr,
		)
	}

	if tvErr != nil {
		fmt.Printf(
			"[ANIME TV DISCOVERY WARNING] %v\n",
			tvErr,
		)
	}

	return finalCards, nil
}

/* =========================================================
   ANIME FILTER OPTIONS
   ========================================================= */

type animeFilterOptions struct {
	movieOptions map[string]string
	tvOptions    map[string]string
}

/* =========================================================
   BASE MOVIE OPTIONS
   ========================================================= */

func animeBaseMovieOptions() map[string]string {
	return map[string]string{
		"language":      "en-US",
		"include_adult": "false",
		"include_video": "false",
	}
}

/* =========================================================
   BASE TV OPTIONS
   ========================================================= */

func animeBaseTVOptions() map[string]string {
	return map[string]string{
		"language":                     "en-US",
		"include_adult":                "false",
		"include_null_first_air_dates": "false",
	}
}

/* =========================================================
   GET FILTER OPTIONS
   ========================================================= */

func getAnimeFilterOptions(
	client *tmdb.Client,
	filter string,
) (animeFilterOptions, error) {

	movieOptions := animeBaseMovieOptions()
	tvOptions := animeBaseTVOptions()

	/*
		=========================================================
		BASE ANIME
		=========================================================
	*/

	movieOptions["with_genres"] = "16"
	movieOptions["with_original_language"] = "ja"
	movieOptions["sort_by"] = "popularity.desc"

	tvOptions["with_genres"] = "16"
	tvOptions["with_original_language"] = "ja"
	tvOptions["sort_by"] = "popularity.desc"

	/*
		=========================================================
		FILTERS
		=========================================================
	*/

	switch filter {

	case "all":
		// Base options are already correct.

	case "new":

		now := time.Now().UTC()

		startDate := now.
			AddDate(-1, 0, 0).
			Format("2006-01-02")

		endDate := now.Format("2006-01-02")

		movieOptions["primary_release_date.gte"] = startDate
		movieOptions["primary_release_date.lte"] = endDate
		movieOptions["sort_by"] = "primary_release_date.desc"

		tvOptions["first_air_date.gte"] = startDate
		tvOptions["first_air_date.lte"] = endDate
		tvOptions["sort_by"] = "first_air_date.desc"

	case "old-gen":

		movieOptions["primary_release_date.lte"] =
			animeOldGenCutoff

		movieOptions["sort_by"] =
			"primary_release_date.desc"

		tvOptions["first_air_date.lte"] =
			animeOldGenCutoff

		tvOptions["sort_by"] =
			"first_air_date.desc"

	case "upcoming":

		now := time.Now().UTC()

		startDate := now.Format("2006-01-02")

		endDate := now.
			AddDate(1, 6, 0).
			Format("2006-01-02")

		movieOptions["primary_release_date.gte"] =
			startDate

		movieOptions["primary_release_date.lte"] =
			endDate

		movieOptions["sort_by"] =
			"primary_release_date.asc"

		tvOptions["first_air_date.gte"] =
			startDate

		tvOptions["first_air_date.lte"] =
			endDate

		tvOptions["sort_by"] =
			"first_air_date.asc"

	case "popular":

		movieOptions["sort_by"] =
			"popularity.desc"

		tvOptions["sort_by"] =
			"popularity.desc"

	case "top-rated":

		movieOptions["sort_by"] =
			"vote_average.desc"

		movieOptions["vote_count.gte"] =
			"100"

		tvOptions["sort_by"] =
			"vote_average.desc"

		tvOptions["vote_count.gte"] =
			"100"

	case "action":

		movieOptions["with_genres"] =
			"16,28"

		tvOptions["with_genres"] =
			"16,10759"

	case "romance":

		movieOptions["with_genres"] =
			"16,10749"

		keywordID := getAnimeKeywordID(
			client,
			[]string{
				"romance",
			},
		)

		if keywordID == 0 {
			return animeFilterOptions{}, fmt.Errorf(
				"TMDB romance keyword was not found",
			)
		}

		tvOptions["with_keywords"] =
			strconv.FormatInt(keywordID, 10)

	case "adventure":

		movieOptions["with_genres"] =
			"16,12"

		tvOptions["with_genres"] =
			"16,10759"

	case "magic":

		keywordID := getAnimeKeywordID(
			client,
			[]string{
				"magic",
			},
		)

		if keywordID == 0 {
			return animeFilterOptions{}, fmt.Errorf(
				"TMDB magic keyword was not found",
			)
		}

		keyword := strconv.FormatInt(
			keywordID,
			10,
		)

		movieOptions["with_keywords"] = keyword
		tvOptions["with_keywords"] = keyword

	case "mystery":

		movieOptions["with_genres"] =
			"16,9648"

		tvOptions["with_genres"] =
			"16,9648"

	case "swordsman":

		keywordID := getAnimeKeywordID(
			client,
			[]string{
				"swordsman",
				"samurai",
				"swordplay",
			},
		)

		if keywordID == 0 {
			return animeFilterOptions{}, fmt.Errorf(
				"TMDB swordsman keyword was not found",
			)
		}

		keyword := strconv.FormatInt(
			keywordID,
			10,
		)

		movieOptions["with_keywords"] = keyword
		tvOptions["with_keywords"] = keyword

	case "ghibli":

		movieOptions["with_companies"] =
			animeGhibliCompanyID

		tvOptions["with_companies"] =
			animeGhibliCompanyID
	}

	return animeFilterOptions{
		movieOptions: movieOptions,
		tvOptions:    tvOptions,
	}, nil
}

/* =========================================================
   FETCH ANIME MOVIE SEEDS
   ========================================================= */

func getAnimeMovieSeeds(
	client *tmdb.Client,
	options map[string]string,
) ([]animeMovieSeed, error) {

	seeds, err := getDiscoverMovieSeeds(
		client,
		options,
		animeCandidatePages,
		animeMaxCandidatesPerType,
	)

	if err != nil {
		return nil, err
	}

	result := make(
		[]animeMovieSeed,
		0,
		len(seeds),
	)

	for _, seed := range seeds {
		result = append(
			result,
			animeMovieSeed{
				ID:          seed.ID,
				Title:       seed.Title,
				ReleaseDate: seed.ReleaseDate,
				PosterPath:  seed.PosterPath,
				GenreIDs:    seed.GenreIDs,
				VoteAverage: seed.VoteAverage,
			},
		)
	}

	return result, nil
}

/* =========================================================
   FETCH ANIME TV SEEDS
   ========================================================= */

func getAnimeTVSeeds(
	client *tmdb.Client,
	baseOptions map[string]string,
) ([]animeTVSeed, error) {

	pages := animeCandidatePages
	maxCandidates := animeMaxCandidatesPerType

	resultsByPage := make(
		[][]animeTVSeed,
		pages,
	)

	errorsCh := make(
		chan error,
		pages,
	)

	var waitGroup sync.WaitGroup

	waitGroup.Add(pages)

	/*
		=========================================================
		FETCH PAGES CONCURRENTLY
		=========================================================
	*/

	for page := 1; page <= pages; page++ {
		pageNumber := page

		go func() {
			defer waitGroup.Done()

			options := make(
				map[string]string,
				len(baseOptions)+1,
			)

			for key, value := range baseOptions {
				options[key] = value
			}

			options["page"] = strconv.Itoa(
				pageNumber,
			)

			response, err := client.GetDiscoverTV(
				options,
			)

			if err != nil {
				errorsCh <- fmt.Errorf(
					"TMDB anime TV page %d: %w",
					pageNumber,
					err,
				)
				return
			}

			if response == nil ||
				response.Results == nil {
				return
			}

			pageSeeds := make(
				[]animeTVSeed,
				0,
				len(response.Results),
			)

			for _, show := range response.Results {
				if show == nil ||
					show.ID == 0 {
					continue
				}

				pageSeeds = append(
					pageSeeds,
					animeTVSeed{
						ID: show.ID,

						Name: strings.TrimSpace(
							show.Name,
						),

						FirstAirDate: strings.TrimSpace(
							show.FirstAirDate,
						),

						PosterPath: strings.TrimSpace(
							show.PosterPath,
						),

						GenreIDs: show.GenreIDs,

						VoteAverage: show.VoteAverage,
					},
				)
			}

			resultsByPage[pageNumber-1] =
				pageSeeds
		}()
	}

	waitGroup.Wait()
	close(errorsCh)

	/*
		=========================================================
		MERGE PAGES IN ORDER
		=========================================================
	*/

	results := make(
		[]animeTVSeed,
		0,
		maxCandidates,
	)

	seen := make(
		map[int64]struct{},
	)

	for _, pageResults := range resultsByPage {
		for _, seed := range pageResults {

			if seed.ID == 0 {
				continue
			}

			if _, exists := seen[seed.ID]; exists {
				continue
			}

			seen[seed.ID] = struct{}{}

			results = append(
				results,
				seed,
			)

			if len(results) >= maxCandidates {
				break
			}
		}

		if len(results) >= maxCandidates {
			break
		}
	}

	/*
		=========================================================
		COLLECT PAGE ERRORS
		=========================================================
	*/

	var firstErr error

	for err := range errorsCh {
		if firstErr == nil {
			firstErr = err
		}
	}

	/*
		If we have no usable data, return the error.
		If we have some data, return the data plus the error
		so the caller can still show the user useful content.
	*/

	if len(results) == 0 && firstErr != nil {
		return nil, firstErr
	}

	return results, firstErr
}

/* =========================================================
   ENRICH TV CARDS
   ========================================================= */

func enrichAnimeTVCards(
	client *tmdb.Client,
	seeds []animeTVSeed,
	filter string,
) []AnimeCard {

	if len(seeds) == 0 {
		return []AnimeCard{}
	}

	type detailResult struct {
		Index int
		Card  AnimeCard
		Valid bool
	}

	results := make(
		chan detailResult,
		len(seeds),
	)

	jobs := make(
		chan int,
	)

	workerCount := animeDetailWorkers

	if len(seeds) < workerCount {
		workerCount = len(seeds)
	}

	var waitGroup sync.WaitGroup

	waitGroup.Add(workerCount)

	/*
		=========================================================
		WORKERS
		=========================================================
	*/

	for worker := 0; worker < workerCount; worker++ {
		go func() {
			defer waitGroup.Done()

			for index := range jobs {
				seed := seeds[index]

				details, err :=
					getAnimeTVDetails(
						client,
						seed.ID,
					)

				if err != nil {
					fmt.Printf(
						"[ANIME TV DETAIL ERROR] ID=%d TITLE=%q ERROR=%v\n",
						seed.ID,
						seed.Name,
						err,
					)

					results <- detailResult{
						Index: index,
						Valid: false,
					}

					continue
				}

				if details == nil {
					results <- detailResult{
						Index: index,
						Valid: false,
					}

					continue
				}

				title := strings.TrimSpace(
					details.Name,
				)

				if title == "" {
					title = strings.TrimSpace(
						seed.Name,
					)
				}

				posterPath := strings.TrimSpace(
					details.PosterPath,
				)

				if posterPath == "" {
					posterPath =
						strings.TrimSpace(
							seed.PosterPath,
						)
				}

				if title == "" ||
					posterPath == "" {

					results <- detailResult{
						Index: index,
						Valid: false,
					}

					continue
				}

				releaseDate := strings.TrimSpace(
					details.FirstAirDate,
				)

				if releaseDate == "" {
					releaseDate = seed.FirstAirDate
				}

				rating := details.VoteAverage

				if rating <= 0 {
					rating = seed.VoteAverage
				}

				results <- detailResult{
					Index: index,
					Valid: true,

					Card: AnimeCard{
						ID: details.ID,

						Title: title,

						MediaType: "series",

						ReleaseYear: formatAnimeYear(
							releaseDate,
						),

						Genre: animeDisplayGenre(
							filter,
							seed.GenreIDs,
							"series",
						),

						Rating: rating,

						PosterURL: tmdb.GetImageURL(
							posterPath,
							tmdb.W185,
						),

						Seasons: details.NumberOfSeasons,

						Episodes: details.NumberOfEpisodes,
					},
				}
			}
		}()
	}

	/*
		=========================================================
		SEND JOBS
		=========================================================
	*/

	for index := range seeds {
		jobs <- index
	}

	close(jobs)

	waitGroup.Wait()
	close(results)

	/*
		=========================================================
		PRESERVE ORIGINAL ORDER
		=========================================================
	*/

	ordered := make(
		[]detailResult,
		len(seeds),
	)

	for result := range results {
		ordered[result.Index] = result
	}

	final := make(
		[]AnimeCard,
		0,
		len(seeds),
	)

	for _, result := range ordered {
		if !result.Valid {
			continue
		}

		final = append(
			final,
			result.Card,
		)
	}

	return final
}

/* =========================================================
   TV DETAIL CACHE
   ========================================================= */

func getAnimeTVDetails(
	client *tmdb.Client,
	id int64,
) (*tmdb.TVDetails, error) {

	/*
		Check cache.
	*/

	animeTVDetailCache.RLock()

	entry, ok :=
		animeTVDetailCache.Items[id]

	animeTVDetailCache.RUnlock()

	if ok &&
		time.Now().Before(entry.ExpiresAt) {

		return entry.Details, nil
	}

	/*
		Request details.
	*/

	details, err := client.GetTVDetails(
		id,
		map[string]string{
			"language": "en-US",
		},
	)

	if err != nil {
		return nil, err
	}

	if details != nil {
		animeTVDetailCache.Lock()

		animeTVDetailCache.Items[id] =
			animeTVDetailCacheEntry{
				ExpiresAt: time.Now().Add(
					animeDetailCacheTTL,
				),

				Details: details,
			}

		animeTVDetailCache.Unlock()
	}

	return details, nil
}

/* =========================================================
   KEYWORD LOOKUP
   ========================================================= */

func getAnimeKeywordID(
	client *tmdb.Client,
	queries []string,
) int64 {

	/*
		=========================================================
		FIRST PASS:
		LOOK FOR AN EXACT MATCH
		=========================================================
	*/

	for _, query := range queries {
		normalized := strings.ToLower(
			strings.TrimSpace(query),
		)

		if normalized == "" {
			continue
		}

		/*
			Check cache.
		*/

		animeKeywordCache.RLock()

		cachedID, found :=
			animeKeywordCache.Items[normalized]

		animeKeywordCache.RUnlock()

		if found &&
			cachedID != 0 {

			return cachedID
		}

		/*
			Search TMDB.
		*/

		response, err :=
			client.GetSearchKeywords(
				query,
				map[string]string{
					"language": "en-US",
					"page":     "1",
				},
			)

		if err != nil ||
			response == nil ||
			response.Results == nil {

			continue
		}

		for _, keyword := range response.Results {
			if keyword == nil ||
				keyword.ID == 0 {

				continue
			}

			if strings.EqualFold(
				strings.TrimSpace(keyword.Name),
				strings.TrimSpace(query),
			) {

				animeKeywordCache.Lock()

				animeKeywordCache.Items[normalized] =
					keyword.ID

				animeKeywordCache.Unlock()

				return keyword.ID
			}
		}
	}

	/*
		=========================================================
		SECOND PASS:
		USE THE FIRST VALID FALLBACK
		=========================================================
	*/

	for _, query := range queries {
		normalized := strings.ToLower(
			strings.TrimSpace(query),
		)

		if normalized == "" {
			continue
		}

		response, err :=
			client.GetSearchKeywords(
				query,
				map[string]string{
					"language": "en-US",
					"page":     "1",
				},
			)

		if err != nil ||
			response == nil ||
			response.Results == nil {

			continue
		}

		for _, keyword := range response.Results {
			if keyword == nil ||
				keyword.ID == 0 {

				continue
			}

			animeKeywordCache.Lock()

			animeKeywordCache.Items[normalized] =
				keyword.ID

			animeKeywordCache.Unlock()

			return keyword.ID
		}
	}

	return 0
}

/* =========================================================
   DISPLAY GENRE
   ========================================================= */

func animeDisplayGenre(
	filter string,
	genreIDs []int64,
	mediaType string,
) string {

	switch filter {
	case "action":
		return "Action"

	case "romance":
		return "Romance"

	case "adventure":
		return "Adventure"

	case "magic":
		return "Magic"

	case "mystery":
		return "Mystery"

	case "swordsman":
		return "Swordsman"

	case "ghibli":
		return "Studio Ghibli"
	}

	if mediaType == "movie" {
		return animeMovieGenreFromIDs(genreIDs)
	}

	return animeTVGenreFromIDs(genreIDs)
}

/* =========================================================
   MOVIE GENRE
   ========================================================= */

func animeMovieGenreFromIDs(
	ids []int64,
) string {

	names := map[int64]string{
		28:    "Action",
		12:    "Adventure",
		16:    "Animation",
		35:    "Comedy",
		80:    "Crime",
		18:    "Drama",
		14:    "Fantasy",
		27:    "Horror",
		9648:  "Mystery",
		10749: "Romance",
		878:   "Sci-Fi",
	}

	for _, id := range ids {
		if name, ok := names[id]; ok {
			return name
		}
	}

	return "Anime"
}

/* =========================================================
   TV GENRE
   ========================================================= */

func animeTVGenreFromIDs(
	ids []int64,
) string {

	names := map[int64]string{
		10759: "Action & Adventure",
		16:    "Animation",
		35:    "Comedy",
		18:    "Drama",
		10765: "Fantasy",
		9648:  "Mystery",
	}

	for _, id := range ids {
		if name, ok := names[id]; ok {
			return name
		}
	}

	return "Anime"
}

/* =========================================================
   FORMAT YEAR
   ========================================================= */

func formatAnimeYear(raw string) string {

	raw = strings.TrimSpace(raw)

	if raw == "" {
		return "TBA"
	}

	if len(raw) >= 4 {
		return raw[:4]
	}

	return raw
}

/* =========================================================
   MERGE MOVIES + SERIES
   ========================================================= */

func mergeAnimeCards(
	movies []AnimeCard,
	series []AnimeCard,
) []AnimeCard {

	result := make(
		[]AnimeCard,
		0,
		animeDisplayLimit,
	)

	movieIndex := 0
	seriesIndex := 0

	/*
		=========================================================
		FIRST PASS
		=========================================================

		Try to maintain approximately 50/50 content.

		The "added" variable is important.

		Without it, if one media type disappears after
		reaching its target, the loop could run forever.
	*/

	for len(result) < animeDisplayLimit {

		added := false

		/*
			Add Movie.
		*/

		if movieIndex < len(movies) &&
			movieIndex < animeMovieTarget {

			result = append(
				result,
				movies[movieIndex],
			)

			movieIndex++
			added = true
		}

		if len(result) >= animeDisplayLimit {
			break
		}

		/*
			Add Series.
		*/

		if seriesIndex < len(series) &&
			seriesIndex < animeTVTarget {

			result = append(
				result,
				series[seriesIndex],
			)

			seriesIndex++
			added = true
		}

		/*
			Neither side could add anything.
		*/

		if !added {
			break
		}

		/*
			Both preferred targets reached.
		*/

		if movieIndex >= animeMovieTarget &&
			seriesIndex >= animeTVTarget {

			break
		}
	}

	/*
		=========================================================
		FILL REMAINING MOVIE SLOTS
		=========================================================
	*/

	for len(result) < animeDisplayLimit &&
		movieIndex < len(movies) {

		result = append(
			result,
			movies[movieIndex],
		)

		movieIndex++
	}

	/*
		=========================================================
		FILL REMAINING SERIES SLOTS
		=========================================================
	*/

	for len(result) < animeDisplayLimit &&
		seriesIndex < len(series) {

		result = append(
			result,
			series[seriesIndex],
		)

		seriesIndex++
	}

	/*
		Safety limit.
	*/

	if len(result) > animeDisplayLimit {
		result = result[:animeDisplayLimit]
	}

	return result
}

/* =========================================================
   CACHE READ
   ========================================================= */

func getCachedAnimeList(
	filter string,
) ([]AnimeCard, bool) {

	animeListCache.RLock()

	entry, ok :=
		animeListCache.Items[filter]

	animeListCache.RUnlock()

	if !ok {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {

		/*
			Clean expired entry.
		*/

		animeListCache.Lock()

		delete(
			animeListCache.Items,
			filter,
		)

		animeListCache.Unlock()

		return nil, false
	}

	copied := append(
		[]AnimeCard(nil),
		entry.Cards...,
	)

	return copied, true
}

/* =========================================================
   CACHE WRITE
   ========================================================= */

func saveCachedAnimeList(
	filter string,
	cards []AnimeCard,
) {

	copied := append(
		[]AnimeCard(nil),
		cards...,
	)

	animeListCache.Lock()

	animeListCache.Items[filter] =
		animeListCacheEntry{
			ExpiresAt: time.Now().Add(
				animeListCacheTTL,
			),

			Cards: copied,
		}

	animeListCache.Unlock()
}
