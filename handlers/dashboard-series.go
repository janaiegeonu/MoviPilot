package handlers

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/benlei/go-tmdb/v2"
)

const (

	// --------------------------------------------------------
	// Final number of cards displayed.
	// --------------------------------------------------------

	seriesDefaultLimit = 66
	seriesFilterLimit  = 48

	seriesDefaultCandidatePages = 5
	seriesFilterCandidatePages  = 4

	// --------------------------------------------------------
	// Maximum candidate pool.
	// --------------------------------------------------------

	seriesDefaultMaxCandidates = 100
	seriesFilterMaxCandidates  = 80

	seriesDetailWorkers = 8

	// --------------------------------------------------------
	// Cache durations.
	// --------------------------------------------------------

	seriesListCacheTTL   = 5 * time.Minute
	seriesDetailCacheTTL = 30 * time.Minute

	// --------------------------------------------------------
	// Number of candidates processed in one wave.
	// --------------------------------------------------------

	seriesEnrichmentBatchSize = 24
)

/* =========================================================
   TEMPLATE DATA
   ========================================================= */

type SeriesPageData struct {
	Shows []SeriesCard
}

type SeriesCard struct {
	ID int64

	Title string

	ReleaseDate string

	Genre string

	Seasons int

	Episodes int

	Rating float32

	PosterURL string
}

/* =========================================================
   RAW TMDB RESULT
   ========================================================= */

type seriesSeed struct {
	ID int64

	Name string

	FirstAirDate string

	PosterPath string

	GenreIDs []int64

	VoteAverage float32
}

/* =========================================================
   LIST CACHE
   ========================================================= */

type seriesListCacheEntry struct {
	ExpiresAt time.Time

	Shows []SeriesCard
}

var seriesListCache = struct {
	sync.RWMutex

	Items map[string]seriesListCacheEntry
}{
	Items: make(
		map[string]seriesListCacheEntry,
	),
}

/* =========================================================
   DETAIL CACHE
   ========================================================= */

type seriesDetailCacheEntry struct {
	ExpiresAt time.Time

	Details *tmdb.TVDetails
}

var seriesDetailCache = struct {
	sync.RWMutex

	Items map[int64]seriesDetailCacheEntry
}{
	Items: make(
		map[int64]seriesDetailCacheEntry,
	),
}

/* =========================================================
   KEYWORD CACHE
   ========================================================= */

var seriesKeywordCache = struct {
	sync.RWMutex

	Items map[string]int64
}{
	Items: make(
		map[string]int64,
	),
}

/* =========================================================
   SERIES PAGE HANDLER
   ========================================================= */

func SeriesPageHandler(
	w http.ResponseWriter,
	r *http.Request,
) {

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

	tmpl, err :=
		template.ParseFiles(
			"templates/series_page.html",
		)

	if err != nil {

		http.Error(
			w,
			"Could not load Series page",
			http.StatusInternalServerError,
		)

		return
	}

	err =
		tmpl.ExecuteTemplate(
			w,
			"series_page",
			SeriesPageData{},
		)

	if err != nil {

		http.Error(
			w,
			"Could not render Series page",
			http.StatusInternalServerError,
		)

		return
	}

}

/* =========================================================
   SERIES CARDS HANDLER
   ========================================================= */

func SeriesCardsHandler(
	w http.ResponseWriter,
	r *http.Request,
) {

	if r.Method != http.MethodGet {

		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)

		return
	}

	filter :=
		strings.ToLower(
			strings.TrimSpace(
				r.URL.Query().Get(
					"filter",
				),
			),
		)

	if filter == "" {

		filter = "all"

	}

	if !validSeriesFilter(
		filter,
	) {

		http.Error(
			w,
			"Invalid Series filter",
			http.StatusBadRequest,
		)

		return
	}

	client, err :=
		newSeriesTMDBClient()

	if err != nil {

		http.Error(
			w,
			"TMDB is not configured",
			http.StatusInternalServerError,
		)

		return
	}

	shows, err :=
		getSeriesCards(
			client,
			filter,
		)

	if err != nil {

		http.Error(
			w,
			"Could not load Series data",
			http.StatusBadGateway,
		)

		return
	}

	/*
		=========================================================
		PARSE SERIES TEMPLATE
		=========================================================
	*/

	tmpl, err :=
		template.ParseFiles(
			"templates/series_page.html",
		)

	if err != nil {

		fmt.Printf(
			"[SERIES TEMPLATE PARSE ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not load Series template",
			http.StatusInternalServerError,
		)

		return
	}

	/*
		=========================================================
		PREPARE TEMPLATE DATA
		=========================================================
	*/

	data :=
		SeriesPageData{
			Shows: shows,
		}

	/*
		=========================================================
		RENDER INTO BUFFER FIRST
		=========================================================

		We do NOT render directly into http.ResponseWriter.

		This allows us to catch a template error before
		anything has been sent to the browser.
	*/

	var buffer bytes.Buffer

	err =
		tmpl.ExecuteTemplate(
			&buffer,
			"series_cards",
			data,
		)

	if err != nil {

		fmt.Printf(
			"[SERIES TEMPLATE EXEC ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not render Series cards",
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

	_, err =
		w.Write(
			buffer.Bytes(),
		)

	if err != nil {

		fmt.Printf(
			"[SERIES RESPONSE ERROR] %v\n",
			err,
		)

		return
	}
}

/* =========================================================
   FILTER VALIDATION
   ========================================================= */

func validSeriesFilter(
	filter string,
) bool {

	switch filter {

	case
		"all",
		"new",
		"upcoming",
		"top-rated",
		"horror",
		"anime",
		"romance",
		"action":

		return true

	default:

		return false

	}

}

/* =========================================================
   TMDB CLIENT
   ========================================================= */

func newSeriesTMDBClient() (
	*tmdb.Client,
	error,
) {

	/*
		=========================================================
		TMDB API KEY
		=========================================================
	*/

	apiKey := strings.TrimSpace(
		os.Getenv("TMDB_API_KEY"),
	)

	if apiKey == "" {

		apiKey =
			strings.TrimSpace(
				os.Getenv("TMDB_TOKEN"),
			)

	}

	if apiKey == "" {

		return nil,
			errors.New(
				"TMDB API key is missing",
			)

	}

	/*
		=========================================================
		CREATE CLIENT
		=========================================================
	*/

	client, err :=
		tmdb.Init(
			apiKey,
		)

	if err != nil {

		return nil, err

	}

	/*
		=========================================================
		AUTOMATIC RATE-LIMIT RETRY
		=========================================================
	*/

	client.SetClientAutoRetry()

	/*
		=========================================================
		REUSABLE HTTP CLIENT
		=========================================================

		This is important because the Series page now performs
		multiple TMDB requests concurrently.

		Connection reuse prevents unnecessary connection setup.
	*/

	client.SetClientConfig(
		&http.Client{

			Timeout: 8 * time.Second,

			Transport: &http.Transport{

				MaxIdleConns: 32,

				MaxIdleConnsPerHost: 16,

				IdleConnTimeout: 60 * time.Second,

				ForceAttemptHTTP2: true,
			},
		},
	)

	return client,
		nil
}

/* =========================================================
   MAIN SERIES PIPELINE
   ========================================================= */

func getSeriesCards(
	client *tmdb.Client,
	filter string,
) ([]SeriesCard, error) {

	/*
		First check the short-lived rendered cache.
	*/

	if cached, ok :=
		getCachedSeriesList(
			filter,
		); ok {

		return cached, nil

	}

	/*
		Get many candidates.

		The candidate pool is deliberately larger than the
		final display amount because some individual details
		may fail or have incomplete artwork.
	*/

	seeds, err :=
		getSeriesSeedsForFilter(
			client,
			filter,
		)

	if err != nil {

		return nil, err

	}

	finalLimit :=
		seriesFilterLimit

	if filter == "all" {

		finalLimit =
			seriesDefaultLimit

	}

	/*
		Progressively enrich candidates.

		This is the major correction.

		We do NOT attempt to trust only the first X candidates.

		Instead, we continue processing batches until we have
		enough valid cards.
	*/

	shows :=
		enrichSeriesCandidatesUntilEnough(
			client,
			seeds,
			finalLimit,
		)

	saveCachedSeriesList(
		filter,
		shows,
	)

	return shows, nil

}

/* =========================================================
   SERIES SOURCE SELECTION
   ========================================================= */

func getSeriesSeedsForFilter(
	client *tmdb.Client,
	filter string,
) ([]seriesSeed, error) {

	switch filter {

	// ========================================================
	// ALL SERIES
	// ========================================================

	case "all":

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":                     "en-US",
				"sort_by":                      "popularity.desc",
				"include_adult":                "false",
				"include_null_first_air_dates": "false",
			},
			seriesDefaultCandidatePages,
			seriesDefaultMaxCandidates,
		)

	// ========================================================
	// NEW SERIES
	//
	// Shows released during the last 12 months.
	// ========================================================

	case "new":

		now := time.Now().UTC()

		startDate := now.AddDate(
			0,
			-12,
			0,
		).Format("2006-01-02")

		endDate := now.Format(
			"2006-01-02",
		)

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":                     "en-US",
				"first_air_date.gte":           startDate,
				"first_air_date.lte":           endDate,
				"sort_by":                      "first_air_date.desc",
				"include_adult":                "false",
				"include_null_first_air_dates": "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// UPCOMING SERIES
	// ========================================================

	case "upcoming":

		now := time.Now().UTC()

		startDate := now.Format(
			"2006-01-02",
		)

		endDate := now.AddDate(
			1,
			6,
			0,
		).Format(
			"2006-01-02",
		)

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":                     "en-US",
				"first_air_date.gte":           startDate,
				"first_air_date.lte":           endDate,
				"sort_by":                      "first_air_date.asc",
				"include_adult":                "false",
				"include_null_first_air_dates": "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// TOP RATED
	// ========================================================

	case "top-rated":

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":       "en-US",
				"sort_by":        "vote_average.desc",
				"vote_count.gte": "100",
				"include_adult":  "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// ACTION
	//
	// TMDB TV Action & Adventure genre = 10759
	// ========================================================

	case "action":

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":      "en-US",
				"with_genres":   "10759",
				"sort_by":       "popularity.desc",
				"include_adult": "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// ANIME
	//
	// Animation + Japanese original language.
	// ========================================================

	case "anime":

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language":               "en-US",
				"with_genres":            "16",
				"with_original_language": "ja",
				"sort_by":                "popularity.desc",
				"include_adult":          "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// HORROR
	//
	// TMDB's TV genre list does not provide Horror as a normal
	// TV genre in the same way it does Action & Adventure,
	// Animation, Drama, etc.
	//
	// Therefore use the TMDB "horror" keyword.
	// ========================================================

	case "horror":

		keywordID := getSeriesKeywordID(
			client,
			"horror",
		)

		if keywordID == 0 {
			return []seriesSeed{}, nil
		}

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language": "en-US",
				"with_keywords": strconv.FormatInt(
					keywordID,
					10,
				),
				"sort_by":       "popularity.desc",
				"include_adult": "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	// ========================================================
	// ROMANCE
	//
	// Romance is also better handled through a TMDB keyword
	// instead of pretending it is a normal TV genre.
	// ========================================================

	case "romance":

		keywordID := getSeriesKeywordID(
			client,
			"romance",
		)

		if keywordID == 0 {
			return []seriesSeed{}, nil
		}

		return getDiscoverSeriesSeeds(
			client,
			map[string]string{
				"language": "en-US",
				"with_keywords": strconv.FormatInt(
					keywordID,
					10,
				),
				"sort_by":       "popularity.desc",
				"include_adult": "false",
			},
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)
	}

	return nil, errors.New(
		"unsupported Series filter",
	)
}

/* =========================================================
   DISCOVER TV SERIES
   ========================================================= */

func getDiscoverSeriesSeeds(
	client *tmdb.Client,
	baseOptions map[string]string,
	pages int,
	maxCandidates int,
) ([]seriesSeed, error) {

	if pages <= 0 ||
		maxCandidates <= 0 {

		return []seriesSeed{}, nil

	}

	/*
		=========================================================
		PER-PAGE RESULT STORAGE
		=========================================================
	*/

	resultsByPage :=
		make(
			[][]seriesSeed,
			pages,
		)

	errorsCh :=
		make(
			chan error,
			pages,
		)

	var waitGroup sync.WaitGroup

	waitGroup.Add(
		pages,
	)

	/*
		=========================================================
		FETCH ALL DISCOVER PAGES CONCURRENTLY
		=========================================================
	*/

	for page := 1; page <= pages; page++ {

		pageNumber :=
			page

		go func() {

			defer waitGroup.Done()

			/*
				Copy the base options.

				Each request gets its own map so
				concurrent goroutines never modify
				the same map.
			*/

			options :=
				make(
					map[string]string,
					len(baseOptions)+1,
				)

			for key, value := range baseOptions {

				options[key] =
					value

			}

			options["page"] =
				strconv.Itoa(
					pageNumber,
				)

			/*
				Request this TMDB page.
			*/

			response, err :=
				client.GetDiscoverTV(
					options,
				)

			if err != nil {

				errorsCh <- err

				return

			}

			if response == nil ||
				response.Results == nil {

				return

			}

			/*
				Convert TMDB results into our
				lightweight seed structure.
			*/

			pageSeeds :=
				make(
					[]seriesSeed,
					0,
					len(response.Results),
				)

			for _, show := range response.Results {

				if show == nil ||
					show.ID == 0 {

					continue

				}

				pageSeeds =
					append(
						pageSeeds,

						seriesSeed{

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

	/*
		=========================================================
		WAIT FOR ALL DISCOVER REQUESTS
		=========================================================
	*/

	waitGroup.Wait()

	close(
		errorsCh,
	)

	/*
		=========================================================
		MERGE RESULTS
		=========================================================

		We rebuild the original TMDB page order after all
		requests finish.
	*/

	results :=
		make(
			[]seriesSeed,
			0,
			maxCandidates,
		)

	seen :=
		make(
			map[int64]struct{},
		)

	for _, pageResults := range resultsByPage {

		for _, seed := range pageResults {

			if seed.ID == 0 {

				continue

			}

			if _, exists :=
				seen[seed.ID]; exists {

				continue

			}

			seen[seed.ID] =
				struct{}{}

			results =
				append(
					results,
					seed,
				)

			if len(results) >=
				maxCandidates {

				return results, nil

			}

		}

	}

	/*
		=========================================================
		ERROR HANDLING
		=========================================================

		Partial success is acceptable.

		Only return an error when every Discover request failed
		and therefore there are no candidates.
	*/

	var firstError error

	for err := range errorsCh {

		if err != nil &&
			firstError == nil {

			firstError =
				err

		}

	}

	if len(results) == 0 &&
		firstError != nil {

		return nil,
			firstError

	}

	return results,
		nil
}

/* =========================================================
   PROGRESSIVE DETAIL ENRICHMENT

   This is the main fix for the "only one card" problem.
   ========================================================= */

/* =========================================================
   PROGRESSIVE DETAIL ENRICHMENT
   ========================================================= */

func enrichSeriesCandidatesUntilEnough(
	client *tmdb.Client,
	seeds []seriesSeed,
	limit int,
) []SeriesCard {

	if limit <= 0 ||
		len(seeds) == 0 {
		return []SeriesCard{}
	}

	cards := make(
		[]SeriesCard,
		0,
		limit,
	)

	// --------------------------------------------------------
	// Process candidates in batches.
	// --------------------------------------------------------

	for start := 0; start < len(seeds) &&
		len(cards) < limit; start += seriesEnrichmentBatchSize {

		end := start +
			seriesEnrichmentBatchSize

		if end > len(seeds) {
			end = len(seeds)
		}

		batch := seeds[start:end]

		enriched := enrichSeriesBatch(
			client,
			batch,
		)

		cards = append(
			cards,
			enriched...,
		)
	}

	// --------------------------------------------------------
	// Never return more than requested.
	// --------------------------------------------------------

	if len(cards) > limit {
		cards = cards[:limit]
	}

	return cards
}

/* =========================================================
   ENRICH ONE BATCH
   ========================================================= */

func enrichSeriesBatch(
	client *tmdb.Client,
	seeds []seriesSeed,
) []SeriesCard {

	if len(seeds) == 0 {
		return []SeriesCard{}
	}

	workerCount := seriesDetailWorkers

	if len(seeds) < workerCount {
		workerCount = len(seeds)
	}

	type batchResult struct {
		Index int
		Card  SeriesCard
		Valid bool
	}

	jobs := make(chan int)

	results := make(
		chan batchResult,
		len(seeds),
	)

	var wg sync.WaitGroup

	wg.Add(workerCount)

	// ========================================================
	// WORKERS
	// ========================================================

	for worker := 0; worker < workerCount; worker++ {

		go func() {

			defer wg.Done()

			for index := range jobs {

				seed := seeds[index]

				details, err := getSeriesDetails(
					client,
					seed.ID,
				)

				if err != nil {

					fmt.Printf(
						"[SERIES DETAIL ERROR] ID=%d TITLE=%q ERROR=%v\n",
						seed.ID,
						seed.Name,
						err,
					)

					results <- batchResult{
						Index: index,
						Valid: false,
					}

					continue
				}

				if details == nil {

					fmt.Printf(
						"[SERIES DETAIL ERROR] ID=%d TITLE=%q returned nil details\n",
						seed.ID,
						seed.Name,
					)

					results <- batchResult{
						Index: index,
						Valid: false,
					}

					continue
				}
				// ------------------------------------------------
				// Title
				// ------------------------------------------------

				title := strings.TrimSpace(
					details.Name,
				)

				if title == "" {
					title = strings.TrimSpace(
						seed.Name,
					)
				}

				// ------------------------------------------------
				// Poster
				// ------------------------------------------------

				posterPath := strings.TrimSpace(
					details.PosterPath,
				)

				if posterPath == "" {
					posterPath = strings.TrimSpace(
						seed.PosterPath,
					)
				}

				// ------------------------------------------------
				// A card without a title or poster is not useful.
				// ------------------------------------------------

				if title == "" ||
					posterPath == "" {

					results <- batchResult{
						Index: index,
						Valid: false,
					}

					continue
				}

				// ------------------------------------------------
				// Genre
				// ------------------------------------------------

				genre := firstSeriesGenre(
					details.Genres,
				)

				if genre == "" {
					genre = seriesGenreFromIDs(
						seed.GenreIDs,
					)
				}

				if genre == "" {
					genre = "Series"
				}

				// ------------------------------------------------
				// Rating
				// ------------------------------------------------

				rating := details.VoteAverage

				if rating <= 0 {
					rating = seed.VoteAverage
				}

				// ------------------------------------------------
				// Build final card.
				// ------------------------------------------------

				card := SeriesCard{

					ID: details.ID,

					Title: title,

					ReleaseDate: formatSeriesDate(
						details.FirstAirDate,
					),

					Genre: genre,

					Seasons: details.NumberOfSeasons,

					Episodes: details.NumberOfEpisodes,

					Rating: rating,

					PosterURL: tmdb.GetImageURL(
						posterPath,
						tmdb.W342,
					),
				}

				results <- batchResult{
					Index: index,
					Card:  card,
					Valid: true,
				}
			}

		}()
	}

	// ========================================================
	// SEND JOBS
	// ========================================================

	for index := range seeds {
		jobs <- index
	}

	close(jobs)

	// ========================================================
	// WAIT FOR ALL WORKERS
	// ========================================================

	wg.Wait()

	close(results)

	// ========================================================
	// RESTORE ORIGINAL TMDB ORDER
	// ========================================================

	ordered := make(
		[]batchResult,
		len(seeds),
	)

	for result := range results {
		ordered[result.Index] = result
	}

	// ========================================================
	// BUILD FINAL COLLECTION
	// ========================================================

	cards := make(
		[]SeriesCard,
		0,
		len(seeds),
	)

	for _, result := range ordered {

		if !result.Valid {
			continue
		}

		cards = append(
			cards,
			result.Card,
		)
	}

	return cards
}

/* =========================================================
   TV DETAILS WITH CACHE
   ========================================================= */

func getSeriesDetails(
	client *tmdb.Client,
	id int64,
) (*tmdb.TVDetails, error) {

	if cached, ok :=
		getCachedSeriesDetails(id); ok {

		return cached, nil

	}

	details, err :=
		client.GetTVDetails(
			id,
			map[string]string{
				"language": "en-US",
			},
		)

	if err != nil {

		return nil, err

	}

	if details != nil {

		saveCachedSeriesDetails(
			id,
			details,
		)

	}

	return details, nil

}

/* =========================================================
   DETAIL CACHE READ
   ========================================================= */

func getCachedSeriesDetails(
	id int64,
) (*tmdb.TVDetails, bool) {

	seriesDetailCache.RLock()

	entry, ok :=
		seriesDetailCache.Items[id]

	seriesDetailCache.RUnlock()

	if !ok {

		return nil, false

	}

	if time.Now().After(
		entry.ExpiresAt,
	) {

		return nil, false

	}

	return entry.Details, true

}

/* =========================================================
   DETAIL CACHE WRITE
   ========================================================= */

func saveCachedSeriesDetails(
	id int64,
	details *tmdb.TVDetails,
) {

	seriesDetailCache.Lock()

	seriesDetailCache.Items[id] =
		seriesDetailCacheEntry{

			ExpiresAt: time.Now().Add(
				seriesDetailCacheTTL,
			),

			Details: details,
		}

	seriesDetailCache.Unlock()

}

/* =========================================================
   LIST CACHE READ
   ========================================================= */

func getCachedSeriesList(filter string) ([]SeriesCard, bool) {
	seriesListCache.RLock()

	entry, ok := seriesListCache.Items[filter]

	seriesListCache.RUnlock()

	// No cached entry found.
	if !ok {
		return nil, false
	}

	// Cached data has expired.
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	// Return a copy so callers cannot modify the cached slice
	// directly.
	copied := append([]SeriesCard(nil), entry.Shows...)

	return copied, true
}

/* =========================================================
   LIST CACHE WRITE
   ========================================================= */

func saveCachedSeriesList(
	filter string,
	shows []SeriesCard,
) {

	copied :=
		append(
			[]SeriesCard(nil),
			shows...,
		)

	seriesListCache.Lock()

	seriesListCache.Items[filter] =
		seriesListCacheEntry{

			ExpiresAt: time.Now().Add(
				seriesListCacheTTL,
			),

			Shows: copied,
		}

	seriesListCache.Unlock()

}

/* =========================================================
   KEYWORD LOOKUP
   ========================================================= */

func getSeriesKeywordID(
	client *tmdb.Client,
	query string,
) int64 {

	// --------------------------------------------------------
	// Normalize the search query
	// --------------------------------------------------------

	normalized := strings.ToLower(
		strings.TrimSpace(query),
	)

	if normalized == "" {
		return 0
	}

	// --------------------------------------------------------
	// Check keyword cache first
	// --------------------------------------------------------

	seriesKeywordCache.RLock()

	cachedID, found := seriesKeywordCache.Items[normalized]

	seriesKeywordCache.RUnlock()

	if found {
		return cachedID
	}

	// --------------------------------------------------------
	// Search TMDB for the keyword
	// --------------------------------------------------------

	response, err := client.GetSearchKeywords(
		query,
		map[string]string{
			"language": "en-US",
			"page":     "1",
		},
	)

	if err != nil ||
		response == nil ||
		response.Results == nil {
		return 0
	}

	// --------------------------------------------------------
	// Find an exact keyword match
	// --------------------------------------------------------

	for _, keyword := range response.Results {

		if keyword == nil {
			continue
		}

		if strings.EqualFold(
			strings.TrimSpace(keyword.Name),
			strings.TrimSpace(query),
		) {

			// ------------------------------------------------
			// Save the keyword ID in cache
			// ------------------------------------------------

			seriesKeywordCache.Lock()

			seriesKeywordCache.Items[normalized] = keyword.ID

			seriesKeywordCache.Unlock()

			return keyword.ID
		}
	}

	// --------------------------------------------------------
	// No matching keyword was found
	// --------------------------------------------------------

	return 0
}

/* =========================================================
   FIRST GENRE
   ========================================================= */

func firstSeriesGenre(
	genres []*tmdb.Genre,
) string {

	for _, genre := range genres {

		if genre == nil {

			continue

		}

		name :=
			strings.TrimSpace(
				genre.Name,
			)

		if name != "" {

			return name

		}

	}

	return ""

}

/* =========================================================
   TV GENRE FALLBACK
   ========================================================= */

func seriesGenreFromIDs(
	ids []int64,
) string {

	genreNames :=
		map[int64]string{

			10759: "Action & Adventure",

			16: "Animation",

			35: "Comedy",

			80: "Crime",

			99: "Documentary",

			18: "Drama",

			10751: "Family",

			10762: "Kids",

			9648: "Mystery",

			10763: "News",

			10764: "Reality",

			10765: "Sci-Fi & Fantasy",

			10766: "Soap",

			10767: "Talk",

			10768: "War & Politics",

			37: "Western",
		}

	for _, id := range ids {

		if name, ok :=
			genreNames[id]; ok {

			return name

		}

	}

	return ""

}

/* =========================================================
   FORMAT SERIES DATE
   ========================================================= */

func formatSeriesDate(
	raw string,
) string {

	raw =
		strings.TrimSpace(
			raw,
		)

	if raw == "" {

		return "TBA"

	}

	parsed, err :=
		time.Parse(
			"2006-01-02",
			raw,
		)

	if err != nil {

		return raw

	}

	return parsed.Format(
		"Jan 2, 2006",
	)

}

/* =========================================================
   MERGE SEED COLLECTIONS
   ========================================================= */

func mergeSeriesSeeds(
	first []seriesSeed,
	second []seriesSeed,
	maxCandidates int,
) []seriesSeed {

	results :=
		make([]seriesSeed, 0, maxCandidates)

	seen :=
		make(map[int64]bool)

	addSeeds :=
		func(items []seriesSeed) {

			for _, item := range items {

				if item.ID == 0 ||
					seen[item.ID] {

					continue

				}

				seen[item.ID] =
					true

				results =
					append(
						results,
						item,
					)

				if len(results) >=
					maxCandidates {

					return

				}

			}

		}

	addSeeds(first)

	if len(results) <
		maxCandidates {

		addSeeds(second)

	}

	return results

}
