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
	// Final number of movie cards displayed.
	// --------------------------------------------------------

	movieDisplayLimit = 60

	// --------------------------------------------------------
	// Number of TMDB pages fetched.
	//
	// Discover normally gives us 20 results per page,
	// so 4 pages gives us up to 80 candidates.
	// --------------------------------------------------------

	movieCandidatePages = 4

	// --------------------------------------------------------
	// Maximum candidate pool.
	// --------------------------------------------------------

	movieMaxCandidates = 80

	// --------------------------------------------------------
	// Movie list cache.
	//
	// This is intentionally longer than the Series cache
	// because movie discovery doesn't change every few seconds.
	// --------------------------------------------------------

	movieListCacheTTL = 5 * time.Minute
)

/* =========================================================
   TEMPLATE DATA
   ========================================================= */

type MoviePageData struct {
	Movies []MovieCard
}

/* =========================================================
   MOVIE CARD
   ========================================================= */

type MovieCard struct {
	ID int64

	Title string

	ReleaseYear string

	Genre string

	Rating float32

	PosterURL string
}

/* =========================================================
   RAW MOVIE DISCOVERY RESULT
   ========================================================= */

type movieSeed struct {
	ID int64

	Title string

	ReleaseDate string

	PosterPath string

	GenreIDs []int64

	VoteAverage float32
}

/* =========================================================
   MOVIE LIST CACHE
   ========================================================= */

type movieListCacheEntry struct {
	ExpiresAt time.Time

	Movies []MovieCard
}

var movieListCache = struct {
	sync.RWMutex

	Items map[string]movieListCacheEntry
}{

	Items: make(
		map[string]movieListCacheEntry,
	),
}

/* =========================================================
   MOVIE PAGE HANDLER
   ========================================================= */

func MoviesPageHandler(
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
			"templates/movie_page.html",
		)

	if err != nil {

		http.Error(
			w,
			"Could not load Movies page",
			http.StatusInternalServerError,
		)

		return
	}

	err =
		tmpl.ExecuteTemplate(
			w,
			"movie_page",
			MoviePageData{},
		)

	if err != nil {

		http.Error(
			w,
			"Could not render Movies page",
			http.StatusInternalServerError,
		)

		return
	}

}

/* =========================================================
   MOVIE CARDS HANDLER
   ========================================================= */

func MoviesCardsHandler(
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

	if !validMovieFilter(
		filter,
	) {

		http.Error(
			w,
			"Invalid Movie filter",
			http.StatusBadRequest,
		)

		return
	}

	client, err :=
		newMovieTMDBClient()

	if err != nil {

		http.Error(
			w,
			"TMDB is not configured",
			http.StatusInternalServerError,
		)

		return
	}

	movies, err :=
		getMovieCards(
			client,
			filter,
		)

	if err != nil {

		fmt.Printf(
			"[MOVIE DATA ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not load Movie data",
			http.StatusBadGateway,
		)

		return
	}

	tmpl, err :=
		template.ParseFiles(
			"templates/movie_page.html",
		)

	if err != nil {

		fmt.Printf(
			"[MOVIE TEMPLATE PARSE ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not load Movie template",
			http.StatusInternalServerError,
		)

		return
	}

	data :=
		MoviePageData{
			Movies: movies,
		}

	var buffer bytes.Buffer

	err =
		tmpl.ExecuteTemplate(
			&buffer,
			"movie_cards",
			data,
		)

	if err != nil {

		fmt.Printf(
			"[MOVIE TEMPLATE EXEC ERROR] %v\n",
			err,
		)

		http.Error(
			w,
			"Could not render Movie cards",
			http.StatusInternalServerError,
		)

		return
	}

	w.Header().Set(
		"Content-Type",
		"text/html; charset=utf-8",
	)

	_, err =
		w.Write(
			buffer.Bytes(),
		)

	if err != nil {

		fmt.Printf(
			"[MOVIE RESPONSE ERROR] %v\n",
			err,
		)

	}

}

/* =========================================================
   FILTER VALIDATION
   ========================================================= */

func validMovieFilter(
	filter string,
) bool {

	switch filter {

	case

		"all",

		"new",

		"upcoming",

		"top-rated",

		"popular",

		"action",

		"anime",

		"romance",

		"sci-fi",

		"adventure",

		"horror",

		"cartoon":

		return true

	default:

		return false

	}

}

/* =========================================================
   TMDB CLIENT
   ========================================================= */

func newMovieTMDBClient() (
	*tmdb.Client,
	error,
) {

	apiKey :=
		strings.TrimSpace(
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

	client, err :=
		tmdb.Init(
			apiKey,
		)

	if err != nil {

		return nil,
			err

	}

	client.SetClientAutoRetry()

	client.SetClientConfig(
		&http.Client{

			Timeout: 5 * time.Second,

			Transport: &http.Transport{

				MaxIdleConns: 32,

				MaxIdleConnsPerHost: 16,

				IdleConnTimeout: 60 * time.Second,

				ForceAttemptHTTP2: true,
			},
		},
	)

	return client, nil

}

/* =========================================================
   MAIN MOVIE PIPELINE
   ========================================================= */

func getMovieCards(
	client *tmdb.Client,
	filter string,
) ([]MovieCard, error) {

	/*
		Check server-side cache first.
	*/

	if cached, ok :=
		getCachedMovieList(
			filter,
		); ok {

		return cached, nil

	}

	/*
		Get movie candidates directly
		from Discover.

		No individual movie detail calls.
	*/

	seeds, err :=
		getMovieSeedsForFilter(
			client,
			filter,
		)

	if err != nil {

		return nil, err

	}

	cards :=
		make(
			[]MovieCard,
			0,
			movieDisplayLimit,
		)

	for _, seed := range seeds {

		/*
			A movie without a title
			or poster isn't useful
			for the discovery grid.
		*/

		if strings.TrimSpace(
			seed.Title,
		) == "" {

			continue

		}

		if strings.TrimSpace(
			seed.PosterPath,
		) == "" {

			continue

		}

		cards =
			append(
				cards,
				MovieCard{

					ID: seed.ID,

					Title: seed.Title,

					ReleaseYear: formatMovieYear(
						seed.ReleaseDate,
					),

					Genre: movieGenreFromIDs(
						seed.GenreIDs,
					),

					Rating: seed.VoteAverage,

					/*
						w185 is enough for
						these card dimensions
						and keeps image payload
						lower than w342.
					*/

					PosterURL: tmdb.GetImageURL(
						seed.PosterPath,
						tmdb.W185,
					),
				},
			)

		if len(cards) >=
			movieDisplayLimit {

			break

		}

	}

	saveCachedMovieList(
		filter,
		cards,
	)

	return cards, nil

}

/* =========================================================
   MOVIE FILTER SOURCE SELECTION
   ========================================================= */

func getMovieSeedsForFilter(
	client *tmdb.Client,
	filter string,
) ([]movieSeed, error) {

	switch filter {

	/* =====================================================
	   ALL MOVIES
	   ===================================================== */

	case "all":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"sort_by": "popularity.desc",

				"include_adult": "false",

				"include_video": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   NEW MOVIES

	   Last 12 months.
	   ===================================================== */

	case "new":

		now :=
			time.Now().UTC()

		startDate :=
			now.AddDate(
				-1,
				0,
				0,
			).Format(
				"2006-01-02",
			)

		endDate :=
			now.Format(
				"2006-01-02",
			)

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"primary_release_date.gte": startDate,

				"primary_release_date.lte": endDate,

				"sort_by": "primary_release_date.desc",

				"include_adult": "false",

				"include_video": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   UPCOMING MOVIES

	   Today -> next 18 months.
	   ===================================================== */

	case "upcoming":

		now :=
			time.Now().UTC()

		startDate :=
			now.Format(
				"2006-01-02",
			)

		endDate :=
			now.AddDate(
				1,
				6,
				0,
			).Format(
				"2006-01-02",
			)

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"primary_release_date.gte": startDate,

				"primary_release_date.lte": endDate,

				"sort_by": "primary_release_date.asc",

				"include_adult": "false",

				"include_video": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   TOP RATED
	   ===================================================== */

	case "top-rated":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"sort_by": "vote_average.desc",

				"vote_count.gte": "250",

				"include_adult": "false",

				"include_video": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   POPULAR
	   ===================================================== */

	case "popular":

		now :=
			time.Now().UTC()

		endDate :=
			now.Format(
				"2006-01-02",
			)

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"primary_release_date.lte": endDate,

				"sort_by": "popularity.desc",

				"vote_count.gte": "50",

				"include_adult": "false",

				"include_video": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   ACTION
	   ===================================================== */

	case "action":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "28",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   ANIME

	   Animation + Japanese language.
	   ===================================================== */

	case "anime":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "16",

				"with_original_language": "ja",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   ROMANCE
	   ===================================================== */

	case "romance":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "10749",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   SCI-FI
	   ===================================================== */

	case "sci-fi":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "878",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   ADVENTURE
	   ===================================================== */

	case "adventure":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "12",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   HORROR
	   ===================================================== */

	case "horror":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "27",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	/* =====================================================
	   CARTOON

	   Animation + Family gives this a
	   more family/cartoon-oriented pool
	   than the Anime filter.
	   ===================================================== */

	case "cartoon":

		return getDiscoverMovieSeeds(
			client,

			map[string]string{

				"language": "en-US",

				"with_genres": "16,10751",

				"sort_by": "popularity.desc",

				"include_adult": "false",
			},

			movieCandidatePages,

			movieMaxCandidates,
		)

	}

	return nil,
		errors.New(
			"unsupported Movie filter",
		)

}

/* =========================================================
   DISCOVER MOVIES

   Fetch multiple pages concurrently.
   ========================================================= */

func getDiscoverMovieSeeds(
	client *tmdb.Client,
	baseOptions map[string]string,
	pages int,
	maxCandidates int,
) ([]movieSeed, error) {

	if pages <= 0 {
		return []movieSeed{}, nil
	}

	resultsByPage :=
		make(
			[][]*tmdb.DiscoverMovieResult,
			pages,
		)

	errorsCh :=
		make(
			chan error,
			pages,
		)

	var wg sync.WaitGroup

	wg.Add(
		pages,
	)

	for page := 1; page <= pages; page++ {

		pageNumber :=
			page

		go func() {

			defer wg.Done()

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

			response, err :=
				client.GetDiscoverMovie(
					options,
				)

			if err != nil {

				errorsCh <- fmt.Errorf(
					"TMDB movie page %d: %w",
					pageNumber,
					err,
				)

				return

			}

			if response == nil ||
				response.Results == nil {

				return

			}

			resultsByPage[pageNumber-1] =
				response.Results

		}()

	}

	wg.Wait()

	close(errorsCh)

	/*
		We tolerate partial page failures.

		If at least one page succeeded,
		we can still build a useful collection.
	*/

	var firstErr error

	for err := range errorsCh {

		if firstErr == nil {

			firstErr = err

		}

	}

	/*
		Build the final candidate list
		in TMDB page order.
	*/

	seeds :=
		make(
			[]movieSeed,
			0,
			maxCandidates,
		)

	seen :=
		make(
			map[int64]struct{},
		)

	for _, pageResults := range resultsByPage {

		for _, movie := range pageResults {

			if movie == nil ||
				movie.ID == 0 {

				continue

			}

			if _, exists :=
				seen[movie.ID]; exists {

				continue

			}

			if _, exists :=
				seen[movie.ID]; exists {

				continue
			}

			seen[movie.ID] = struct{}{}

			seeds =
				append(
					seeds,

					movieSeed{

						ID: movie.ID,

						Title: strings.TrimSpace(
							movie.Title,
						),

						ReleaseDate: strings.TrimSpace(
							movie.ReleaseDate,
						),

						PosterPath: strings.TrimSpace(
							movie.PosterPath,
						),

						GenreIDs: movie.GenreIDs,

						VoteAverage: movie.VoteAverage,
					},
				)

			if len(seeds) >=
				maxCandidates {

				return seeds, nil

			}

		}

	}

	if len(seeds) == 0 &&
		firstErr != nil {

		return nil, firstErr

	}

	return seeds, nil

}

/* =========================================================
   MOVIE GENRE MAPPING
   ========================================================= */

func movieGenreFromIDs(
	ids []int64,
) string {

	genreNames :=
		map[int64]string{

			28: "Action",

			12: "Adventure",

			16: "Animation",

			35: "Comedy",

			80: "Crime",

			99: "Documentary",

			18: "Drama",

			10751: "Family",

			14: "Fantasy",

			36: "History",

			27: "Horror",

			10402: "Music",

			9648: "Mystery",

			10749: "Romance",

			878: "Sci-Fi",

			53: "Thriller",

			10752: "War",

			37: "Western",
		}

	for _, id := range ids {

		if name, ok :=
			genreNames[id]; ok {

			return name

		}

	}

	return "Movie"

}

/* =========================================================
   MOVIE YEAR FORMAT
   ========================================================= */

func formatMovieYear(
	raw string,
) string {

	raw =
		strings.TrimSpace(
			raw,
		)

	if raw == "" {

		return "TBA"

	}

	/*
		We only need the release year
		for the compact movie card.
	*/

	if len(raw) >= 4 {

		return raw[:4]

	}

	return raw

}

/* =========================================================
   MOVIE CACHE READ
   ========================================================= */

func getCachedMovieList(
	filter string,
) ([]MovieCard, bool) {

	movieListCache.RLock()

	entry, ok :=
		movieListCache.Items[filter]

	movieListCache.RUnlock()

	if !ok {

		return nil, false

	}

	if time.Now().After(
		entry.ExpiresAt,
	) {

		return nil, false

	}

	copied :=
		append(
			[]MovieCard(nil),
			entry.Movies...,
		)

	return copied, true

}

/* =========================================================
   MOVIE CACHE WRITE
   ========================================================= */

func saveCachedMovieList(
	filter string,
	movies []MovieCard,
) {

	copied :=
		append(
			[]MovieCard(nil),
			movies...,
		)

	movieListCache.Lock()

	movieListCache.Items[filter] =
		movieListCacheEntry{

			ExpiresAt: time.Now().Add(
				movieListCacheTTL,
			),

			Movies: copied,
		}

	movieListCache.Unlock()

}
