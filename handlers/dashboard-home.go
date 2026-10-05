package handlers

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/benlei/go-tmdb/v2"
)

type DashboardPageData struct {
	TrendingMovies []DashboardHeroMovie

	MayLikeMovies []DashboardMovieCard

	TopRatedMovies []DashboardMovieCard

	PopularTrailerMovies []DashboardTrailerCard
}

/* =========================================================
   HERO MOVIE
   ---------------------------------------------------------
   Used by the existing Trending Today hero.
   ========================================================= */

type DashboardHeroMovie struct {
	ID int64

	TrendingRank string

	Title string

	Genre string

	ReleaseDate string

	Runtime string

	Overview string

	Rating float32

	PosterURL string

	BackdropURL string

	TrailerURL string
}

/* =========================================================
   STANDARD MOVIE CARD
   ---------------------------------------------------------
   Used by:

   - Movies You May Like
   - Top Rated Movies
   ========================================================= */

type DashboardMovieCard struct {
	ID int64

	Title string

	Genre string

	Year string

	Runtime string

	Rating float32

	PosterURL string
}

/* =========================================================
   TRAILER CARD
   ---------------------------------------------------------
   Used by Popular Movies Trailers.
   ========================================================= */

type DashboardTrailerCard struct {
	ID int64

	Title string

	Genre string

	Year string

	Runtime string

	BackdropURL string

	TrailerURL string
}

/* =========================================================
   INTERNAL MOVIE SEED
   ---------------------------------------------------------
   A lightweight representation used before
   movie details are fetched.
   ========================================================= */

type dashboardMovieSeed struct {
	ID int64

	Title string

	GenreIDs []int64

	GenreOverride string

	ReleaseDate string

	PosterPath string

	BackdropPath string

	Rating float32
}

/* =========================================================
   DASHBOARD PAGE CACHE
   ========================================================= */

const dashboardPageCacheTTL = 5 * time.Minute

type dashboardPageCacheEntry struct {
	ExpiresAt time.Time
	Data      DashboardPageData
}

var dashboardPageCache = struct {
	sync.RWMutex
	Entry dashboardPageCacheEntry
}{}

/* =========================================================
   DASHBOARD CACHE READ
   ========================================================= */

func getCachedDashboardPageData() (DashboardPageData, bool) {

	dashboardPageCache.RLock()

	entry := dashboardPageCache.Entry

	dashboardPageCache.RUnlock()

	if entry.ExpiresAt.IsZero() {

		return DashboardPageData{},
			false

	}

	if time.Now().After(
		entry.ExpiresAt,
	) {

		return DashboardPageData{},
			false

	}

	/*
		Copy the slices so callers don't directly
		modify the cached slice backing arrays.
	*/

	data := DashboardPageData{

		TrendingMovies: append(
			[]DashboardHeroMovie(nil),
			entry.Data.TrendingMovies...,
		),

		MayLikeMovies: append(
			[]DashboardMovieCard(nil),
			entry.Data.MayLikeMovies...,
		),

		TopRatedMovies: append(
			[]DashboardMovieCard(nil),
			entry.Data.TopRatedMovies...,
		),

		PopularTrailerMovies: append(
			[]DashboardTrailerCard(nil),
			entry.Data.PopularTrailerMovies...,
		),
	}

	return data,
		true
}

/* =========================================================
   DASHBOARD CACHE WRITE
   ========================================================= */

func saveDashboardPageData(
	data DashboardPageData,
) {

	copied := DashboardPageData{

		TrendingMovies: append(
			[]DashboardHeroMovie(nil),
			data.TrendingMovies...,
		),

		MayLikeMovies: append(
			[]DashboardMovieCard(nil),
			data.MayLikeMovies...,
		),

		TopRatedMovies: append(
			[]DashboardMovieCard(nil),
			data.TopRatedMovies...,
		),

		PopularTrailerMovies: append(
			[]DashboardTrailerCard(nil),
			data.PopularTrailerMovies...,
		),
	}

	dashboardPageCache.Lock()

	dashboardPageCache.Entry =
		dashboardPageCacheEntry{

			ExpiresAt: time.Now().Add(
				dashboardPageCacheTTL,
			),

			Data: copied,
		}

	dashboardPageCache.Unlock()
}

/* =========================================================
   DASHBOARD HANDLER
   ========================================================= */

/* =========================================================
   DASHBOARD HANDLER
   ========================================================= */

func DashBoardHandler(
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

	w.Header().Set(
		"Cache-Control",
		"private, max-age=30, stale-while-revalidate=120",
	)

	/* =====================================================
	   CHECK SERVER CACHE
	   ===================================================== */

	if cachedData, ok :=
		getCachedDashboardPageData(); ok {

		err :=
			renderTemplate(
				w,
				"dashboard.html",
				cachedData,
			)

		if err != nil {

			fmt.Println(
				"DASHBOARD CACHED RENDER ERROR:",
				err,
			)

			http.Error(
				w,
				"Failed to render dashboard",
				http.StatusInternalServerError,
			)

		}

		return
	}

	/* =====================================================
	   INITIALIZE OPTIMIZED TMDB CLIENT
	   ===================================================== */

	tmdbClient, err :=
		newMovieTMDBClient()

	if err != nil {

		fmt.Println(
			"TMDB CLIENT ERROR:",
			err,
		)

		http.Error(
			w,
			"Failed to initialize TMDB client",
			http.StatusInternalServerError,
		)

		return
	}

	/* =====================================================
	   1. TRENDING TODAY HERO
	   ===================================================== */

	trendingMovies, err :=
		getDashboardTrendingMovies(
			tmdbClient,
			6,
		)

	if err != nil {

		fmt.Println(
			"TRENDING HERO ERROR:",
			err,
		)

		http.Error(
			w,
			"Failed to load trending movies",
			http.StatusBadGateway,
		)

		return
	}

	/* =====================================================
	   2. MOVIES YOU MAY LIKE
	   ===================================================== */

	mayLikeSeeds :=
		getDashboardMayLikeSeeds(
			tmdbClient,
		)

	mayLikeMovies :=
		enrichDashboardMovieCards(
			tmdbClient,
			mayLikeSeeds,
			44,
		)

	/* =====================================================
	   3. TOP RATED
	   ===================================================== */

	topRatedSeeds :=
		getDashboardTopRatedSeeds(
			tmdbClient,
			44,
		)

	topRatedMovies :=
		enrichDashboardMovieCards(
			tmdbClient,
			topRatedSeeds,
			44,
		)

	/* =====================================================
	   4. POPULAR TRAILERS
	   ===================================================== */

	popularTrailerSeeds :=
		getDashboardPopularTrailerSeeds(
			tmdbClient,
		)

	popularTrailerMovies :=
		enrichDashboardTrailerCards(
			tmdbClient,
			popularTrailerSeeds,
			30,
		)

	/* =====================================================
	   FINAL TEMPLATE DATA
	   ===================================================== */

	pageData :=
		DashboardPageData{

			TrendingMovies: trendingMovies,

			MayLikeMovies: mayLikeMovies,

			TopRatedMovies: topRatedMovies,

			PopularTrailerMovies: popularTrailerMovies,
		}

	/* =====================================================
	   SAVE PAGE CACHE
	   ===================================================== */

	saveDashboardPageData(
		pageData,
	)

	/* =====================================================
	   RENDER
	   ===================================================== */

	err =
		renderTemplate(
			w,
			"dashboard.html",
			pageData,
		)

	if err != nil {

		fmt.Println(
			"DASHBOARD RENDER ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to render dashboard page",
			http.StatusInternalServerError,
		)

		return
	}

}

/* =========================================================
   TRENDING TODAY
   ========================================================= */

func getDashboardTrendingMovies(
	tmdbClient *tmdb.Client,
	limit int,
) ([]DashboardHeroMovie, error) {

	trending, err :=
		tmdbClient.GetTrending(
			"movie",
			"day",
		)

	if err != nil {

		return nil, err

	}

	if trending == nil ||
		trending.TrendingResults == nil {

		return nil,
			fmt.Errorf(
				"TMDB returned no trending movies",
			)

	}

	movies :=
		make(
			[]DashboardHeroMovie,
			0,
			limit,
		)

	for _, item := range trending.Results {

		if item == nil {

			continue

		}

		if item.BackdropPath == "" ||
			item.PosterPath == "" {

			continue

		}

		movie :=
			DashboardHeroMovie{

				ID: item.ID,

				TrendingRank: fmt.Sprintf(
					"%02d",
					len(movies)+1,
				),

				Title: item.Title,

				Overview: item.Overview,

				ReleaseDate: formatDashboardDate(
					item.ReleaseDate,
				),

				Rating: item.VoteAverage,

				BackdropURL: tmdb.GetImageURL(
					item.BackdropPath,
					tmdb.W1280,
				),

				PosterURL: tmdb.GetImageURL(
					item.PosterPath,
					tmdb.W780,
				),
			}

		/*
		   Runtime, full genre name and trailer
		   come from movie details.
		*/

		details, detailErr :=
			tmdbClient.GetMovieDetails(
				item.ID,
				map[string]string{
					"language": "en-US",

					"append_to_response": "videos",
				},
			)

		if detailErr == nil &&
			details != nil {

			if details.Title != "" {

				movie.Title =
					details.Title

			}

			if details.Overview != "" {

				movie.Overview =
					details.Overview

			}

			if details.ReleaseDate != "" {

				movie.ReleaseDate =
					formatDashboardDate(
						details.ReleaseDate,
					)

			}

			movie.Runtime =
				formatDashboardRuntime(
					details.Runtime,
				)

			movie.Genre =
				firstDashboardGenre(
					details.Genres,
				)

			movie.TrailerURL =
				findDashboardTrailer(
					details,
				)

		}

		if movie.Genre == "" {

			movie.Genre =
				genreNameFromID(
					firstGenreID(
						item.GenreIDs,
					),
				)

		}

		if movie.Genre == "" {

			movie.Genre =
				"Movie"

		}

		movies =
			append(
				movies,
				movie,
			)

		if len(movies) >= limit {

			break

		}

	}

	if len(movies) == 0 {

		return nil,
			fmt.Errorf(
				"TMDB returned no usable trending movies",
			)

	}

	return movies, nil

}

/* =========================================================
   MOVIES YOU MAY LIKE
   ---------------------------------------------------------
   Mix:

   - Weekly trending
   - Action
   - Romance
   - A small amount of anime
   ========================================================= */

func getDashboardMayLikeSeeds(
	tmdbClient *tmdb.Client,
) []dashboardMovieSeed {

	const limit = 44
	var weeklySeeds []dashboardMovieSeed

	var actionSeeds []dashboardMovieSeed

	var romanceSeeds []dashboardMovieSeed

	var animeSeeds []dashboardMovieSeed

	/* =====================================================
	   WEEKLY TRENDING
	   ===================================================== */

	weekly,
		err :=
		tmdbClient.GetTrending(
			"movie",
			"week",
		)

	if err == nil &&
		weekly != nil &&
		weekly.TrendingResults != nil {

		for _, movie := range weekly.Results {

			if movie == nil {

				continue

			}

			weeklySeeds =
				append(
					weeklySeeds,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						GenreIDs: movie.GenreIDs,

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						Rating: movie.VoteAverage,
					},
				)

		}

	} else {

		fmt.Println(
			"WEEKLY TRENDING ERROR:",
			err,
		)

	}

	/* =====================================================
	   ACTION
	   ===================================================== */

	action,
		err :=
		tmdbClient.GetDiscoverMovie(
			map[string]string{

				"language": "en-US",

				"page": "1",

				"sort_by": "popularity.desc",

				"include_adult": "false",

				"include_video": "false",

				"with_genres": "28",

				"vote_average.gte": "6.3",

				"vote_count.gte": "300",
			},
		)

	if err == nil &&
		action != nil {

		for _, movie := range action.Results {

			if movie == nil {

				continue

			}

			actionSeeds =
				append(
					actionSeeds,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						GenreIDs: movie.GenreIDs,

						GenreOverride: "Action",

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						Rating: movie.VoteAverage,
					},
				)

		}

	} else {

		fmt.Println(
			"ACTION DISCOVER ERROR:",
			err,
		)

	}

	/* =====================================================
	   ROMANCE
	   ===================================================== */

	romance,
		err :=
		tmdbClient.GetDiscoverMovie(
			map[string]string{

				"language": "en-US",

				"page": "1",

				"sort_by": "popularity.desc",

				"include_adult": "false",

				"include_video": "false",

				"with_genres": "10749",

				"vote_average.gte": "6.2",

				"vote_count.gte": "200",
			},
		)

	if err == nil &&
		romance != nil {

		for _, movie := range romance.Results {

			if movie == nil {

				continue

			}

			romanceSeeds =
				append(
					romanceSeeds,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						GenreIDs: movie.GenreIDs,

						GenreOverride: "Romance",

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						Rating: movie.VoteAverage,
					},
				)

		}

	} else {

		fmt.Println(
			"ROMANCE DISCOVER ERROR:",
			err,
		)

	}

	/* =====================================================
	   ANIME
	   -----------------------------------------------------
	   TMDB classifies anime primarily through
	   Animation + original Japanese language.
	   ===================================================== */

	anime,
		err :=
		tmdbClient.GetDiscoverMovie(
			map[string]string{

				"language": "en-US",

				"page": "1",

				"sort_by": "popularity.desc",

				"include_adult": "false",

				"include_video": "false",

				"with_genres": "16",

				"with_original_language": "ja",

				"vote_average.gte": "6.2",

				"vote_count.gte": "100",
			},
		)

	if err == nil &&
		anime != nil {

		for _, movie := range anime.Results {

			if movie == nil {

				continue

			}

			animeSeeds =
				append(
					animeSeeds,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						GenreIDs: movie.GenreIDs,

						GenreOverride: "Anime",

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						Rating: movie.VoteAverage,
					},
				)

		}

	} else {

		fmt.Println(
			"ANIME DISCOVER ERROR:",
			err,
		)

	}

	/* =====================================================
	   MIX THE SOURCES
	   -----------------------------------------------------
	   Target distribution:

	   12 weekly
	    6 action
	    4 romance
	    2 anime
	   ===================================================== */

	result :=
		make(
			[]dashboardMovieSeed,
			0,
			limit,
		)

	seen :=
		make(
			map[int64]bool,
		)

	appendFromPool :=
		func(
			pool []dashboardMovieSeed,
			count int,
		) {

			added :=
				0

			for _, movie := range pool {

				if added >= count ||
					len(result) >= limit {

					break

				}

				if movie.ID == 0 ||
					seen[movie.ID] {

					continue

				}

				if movie.PosterPath == "" {

					continue

				}

				seen[movie.ID] =
					true

				result =
					append(
						result,
						movie,
					)

				added++

			}

		}

	appendFromPool(
		weeklySeeds,
		20,
	)

	appendFromPool(
		actionSeeds,
		12,
	)

	appendFromPool(
		romanceSeeds,
		8,
	)

	appendFromPool(
		animeSeeds,
		4,
	)

	/* =====================================================
	   FILL ANY REMAINING SPACES
	   ===================================================== */

	fillPools :=
		[][]dashboardMovieSeed{
			weeklySeeds,
			actionSeeds,
			romanceSeeds,
			animeSeeds,
		}

	for _, pool := range fillPools {

		for _, movie := range pool {

			if len(result) >= limit {

				break

			}

			if movie.ID == 0 ||
				seen[movie.ID] {

				continue

			}

			if movie.PosterPath == "" {

				continue

			}

			seen[movie.ID] =
				true

			result =
				append(
					result,
					movie,
				)

		}

	}

	return result

}

/* =========================================================
   TOP RATED SEEDS
   ========================================================= */

func getDashboardTopRatedSeeds(
	tmdbClient *tmdb.Client,
	limit int,
) []dashboardMovieSeed {

	result :=
		make(
			[]dashboardMovieSeed,
			0,
			limit,
		)

	seen :=
		make(
			map[int64]bool,
		)

	/*
	   Two pages give us enough material to
	   reliably build the first 24 cards.
	*/

	for page := 1; page <= 4 &&
		len(result) < limit; page++ {
		topRated,
			err :=
			tmdbClient.GetMovieTopRated(
				map[string]string{

					"language": "en-US",

					"page": fmt.Sprintf(
						"%d",
						page,
					),
				},
			)

		if err != nil {

			fmt.Println(
				"TOP RATED ERROR:",
				err,
			)

			continue

		}

		if topRated == nil ||
			topRated.MoviePopularResults == nil {

			continue

		}

		for _, movie := range topRated.Results {

			if len(result) >= limit {

				break

			}

			if movie == nil ||
				movie.ID == 0 ||
				seen[movie.ID] {

				continue

			}

			if movie.PosterPath == "" {

				continue

			}

			seen[movie.ID] =
				true

			result =
				append(
					result,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						Rating: movie.VoteAverage,
					},
				)

		}

	}

	return result

}

/* =========================================================
   POPULAR TRAILER SEEDS
   ========================================================= */

func getDashboardPopularTrailerSeeds(
	tmdbClient *tmdb.Client,
) []dashboardMovieSeed {

	const candidateLimit = 60

	result :=
		make(
			[]dashboardMovieSeed,
			0,
			candidateLimit,
		)

	seen :=
		make(
			map[int64]bool,
		)

	/*
	   Three pages gives us up to 60 popular
	   movie candidates.

	   We also prefer TMDB entries marked as
	   containing video content.
	*/

	for page := 1; page <= 3 &&
		len(result) < candidateLimit; page++ {

		popular,
			err :=
			tmdbClient.GetMoviePopular(
				map[string]string{

					"language": "en-US",

					"page": fmt.Sprintf(
						"%d",
						page,
					),
				},
			)

		if err != nil {

			fmt.Println(
				"POPULAR MOVIES ERROR:",
				err,
			)

			continue

		}

		if popular == nil ||
			popular.MoviePopularResults == nil {

			continue

		}

		for _, movie := range popular.Results {

			if len(result) >= candidateLimit {

				break

			}

			if movie == nil ||
				movie.ID == 0 ||
				seen[movie.ID] {

				continue

			}

			/*
			   We need landscape artwork.
			*/

			if movie.BackdropPath == "" {

				continue

			}

			/*
			   TMDB's movie-list response exposes
			   a Video flag. Prefer those entries
			   because they're more likely to have
			   usable video data.
			*/

			if !movie.Video {

				continue

			}

			seen[movie.ID] =
				true

			result =
				append(
					result,
					dashboardMovieSeed{

						ID: movie.ID,

						Title: movie.Title,

						ReleaseDate: movie.ReleaseDate,

						PosterPath: movie.PosterPath,

						BackdropPath: movie.BackdropPath,

						GenreIDs: nil,

						Rating: movie.VoteAverage,
					},
				)

		}

	}

	/*
	   If the Video flag leaves us with too few
	   candidates, do a second pass without it.
	*/

	if len(result) < 30 {

		for page := 1; page <= 3 &&
			len(result) < candidateLimit; page++ {

			popular,
				err :=
				tmdbClient.GetMoviePopular(
					map[string]string{

						"language": "en-US",

						"page": fmt.Sprintf(
							"%d",
							page,
						),
					},
				)

			if err != nil {

				continue

			}

			if popular == nil ||
				popular.MoviePopularResults == nil {

				continue

			}

			for _, movie := range popular.Results {

				if len(result) >= candidateLimit {

					break

				}

				if movie == nil ||
					movie.ID == 0 ||
					seen[movie.ID] {

					continue

				}

				if movie.BackdropPath == "" {

					continue

				}

				seen[movie.ID] =
					true

				result =
					append(
						result,
						dashboardMovieSeed{

							ID: movie.ID,

							Title: movie.Title,

							ReleaseDate: movie.ReleaseDate,

							PosterPath: movie.PosterPath,

							BackdropPath: movie.BackdropPath,

							Rating: movie.VoteAverage,
						},
					)

			}

		}

	}

	return result

}

/* =========================================================
   ENRICH STANDARD MOVIE CARDS
   ---------------------------------------------------------
   Uses a small worker pool so 24 movie detail requests
   don't all fire at once.
   ========================================================= */

func enrichDashboardMovieCards(
	tmdbClient *tmdb.Client,
	seeds []dashboardMovieSeed,
	limit int,
) []DashboardMovieCard {

	if len(seeds) > limit {

		seeds =
			seeds[:limit]

	}

	results :=
		make(
			[]DashboardMovieCard,
			len(seeds),
		)

	const workerCount = 6

	jobs :=
		make(
			chan int,
		)

	var wg sync.WaitGroup

	for worker := 0; worker < workerCount; worker++ {

		wg.Add(1)

		go func() {

			defer wg.Done()

			for index := range jobs {

				seed :=
					seeds[index]

				card :=
					DashboardMovieCard{

						ID: seed.ID,

						Title: seed.Title,

						Year: formatDashboardYear(
							seed.ReleaseDate,
						),

						Rating: seed.Rating,

						PosterURL: tmdb.GetImageURL(
							seed.PosterPath,
							tmdb.W780,
						),
					}

				/*
				   Start with the known seed genre
				   before movie details arrive.
				*/

				if seed.GenreOverride != "" {

					card.Genre =
						seed.GenreOverride

				} else {

					card.Genre =
						genreNameFromID(
							firstGenreID(
								seed.GenreIDs,
							),
						)

				}

				details,
					err :=
					tmdbClient.GetMovieDetails(
						seed.ID,
						map[string]string{
							"language": "en-US",
						},
					)

				if err == nil &&
					details != nil {

					if details.Title != "" {

						card.Title =
							details.Title

					}

					if details.ReleaseDate != "" {

						card.Year =
							formatDashboardYear(
								details.ReleaseDate,
							)

					}

					if details.VoteAverage > 0 {

						card.Rating =
							details.VoteAverage

					}

					card.Runtime =
						formatDashboardRuntime(
							details.Runtime,
						)

					/*
					   Prefer the proper TMDB genre name
					   when we don't have an explicit
					   recommendation category.
					*/

					if seed.GenreOverride == "" {

						card.Genre =
							firstDashboardGenre(
								details.Genres,
							)

					}

				}

				if card.Genre == "" {

					card.Genre =
						"Movie"

				}

				if card.Runtime == "" {

					card.Runtime =
						"—"

				}

				results[index] =
					card

			}

		}()

	}

	for index := range seeds {

		jobs <- index

	}

	close(jobs)

	wg.Wait()

	/*
	   Remove completely unusable entries while
	   preserving the API response order.
	*/

	finalResults :=
		make(
			[]DashboardMovieCard,
			0,
			len(results),
		)

	for _, card := range results {

		if card.ID == 0 ||
			card.Title == "" ||
			card.PosterURL == "" {

			continue

		}

		finalResults =
			append(
				finalResults,
				card,
			)

	}

	return finalResults

}

/* =========================================================
   ENRICH TRAILER CARDS
   ---------------------------------------------------------
   Movie details + videos are loaded together.
   ========================================================= */

func enrichDashboardTrailerCards(
	tmdbClient *tmdb.Client,
	seeds []dashboardMovieSeed,
	limit int,
) []DashboardTrailerCard {

	if len(seeds) == 0 {

		return nil

	}

	/*
	   One indexed slot per candidate.

	   This lets workers run concurrently while
	   preserving the original TMDB ordering.
	*/

	results :=
		make(
			[]*DashboardTrailerCard,
			len(seeds),
		)

	const workerCount = 6

	jobs :=
		make(
			chan int,
		)

	var wg sync.WaitGroup

	for worker := 0; worker < workerCount; worker++ {

		wg.Add(1)

		go func() {

			defer wg.Done()

			for index := range jobs {

				seed :=
					seeds[index]

				details,
					err :=
					tmdbClient.GetMovieDetails(
						seed.ID,
						map[string]string{

							"language": "en-US",

							"append_to_response": "videos",
						},
					)

				if err != nil ||
					details == nil {

					continue

				}

				trailerURL :=
					findDashboardTrailer(
						details,
					)

				/*
				   This is the critical filter.

				   No trailer = no trailer card.
				*/

				if trailerURL == "" {

					continue

				}

				genre :=
					firstDashboardGenre(
						details.Genres,
					)

				if genre == "" {

					genre =
						genreNameFromID(
							firstGenreID(
								seed.GenreIDs,
							),
						)

				}

				if genre == "" {

					genre =
						"Movie"

				}

				card :=
					DashboardTrailerCard{

						ID: seed.ID,

						Title: details.Title,

						Genre: genre,

						Year: formatDashboardYear(
							details.ReleaseDate,
						),

						Runtime: formatDashboardRuntime(
							details.Runtime,
						),

						BackdropURL: tmdb.GetImageURL(
							seed.BackdropPath,
							tmdb.W1280,
						),

						TrailerURL: trailerURL,
					}

				results[index] =
					&card

			}

		}()

	}

	for index := range seeds {

		jobs <- index

	}

	close(jobs)

	wg.Wait()

	/*
	   Preserve TMDB ordering and stop once
	   we have the requested 30 usable trailers.
	*/

	finalResults :=
		make(
			[]DashboardTrailerCard,
			0,
			limit,
		)

	for _, card := range results {

		if card == nil {

			continue

		}

		if card.ID == 0 ||
			card.Title == "" ||
			card.BackdropURL == "" ||
			card.TrailerURL == "" {

			continue

		}

		if len(finalResults) >= limit {

			break

		}

		finalResults =
			append(
				finalResults,
				*card,
			)

	}

	return finalResults

}

/* =========================================================
   DATE FORMATTERS
   ========================================================= */

func formatDashboardDate(
	value string,
) string {

	if value == "" {

		return ""

	}

	parsed,
		err :=
		time.Parse(
			"2006-01-02",
			value,
		)

	if err != nil {

		return value

	}

	return parsed.Format(
		"Jan 2, 2006",
	)

}

func formatDashboardYear(
	value string,
) string {

	if value == "" {

		return "—"

	}

	parsed,
		err :=
		time.Parse(
			"2006-01-02",
			value,
		)

	if err != nil {

		if len(value) >= 4 {

			return value[:4]

		}

		return value

	}

	return parsed.Format(
		"2006",
	)

}

/* =========================================================
   RUNTIME FORMATTER
   ========================================================= */

func formatDashboardRuntime(
	minutes int,
) string {

	if minutes <= 0 {

		return ""

	}

	hours :=
		minutes / 60

	remainingMinutes :=
		minutes % 60

	if hours == 0 {

		return fmt.Sprintf(
			"%dm",
			remainingMinutes,
		)

	}

	if remainingMinutes == 0 {

		return fmt.Sprintf(
			"%dh",
			hours,
		)

	}

	return fmt.Sprintf(
		"%dh %dm",
		hours,
		remainingMinutes,
	)

}

/* =========================================================
   FIRST GENRE
   ========================================================= */

func firstDashboardGenre(
	genres []*tmdb.Genre,
) string {

	for _, genre := range genres {

		if genre == nil {

			continue

		}

		if genre.Name != "" {

			return genre.Name

		}

	}

	return ""

}

/* =========================================================
   FIRST GENRE ID
   ========================================================= */

func firstGenreID(
	ids []int64,
) int64 {

	if len(ids) == 0 {

		return 0

	}

	return ids[0]

}

/* =========================================================
   GENRE ID → DISPLAY NAME
   ========================================================= */

func genreNameFromID(
	id int64,
) string {

	switch id {

	case 28:
		return "Action"

	case 12:
		return "Adventure"

	case 16:
		return "Animation"

	case 35:
		return "Comedy"

	case 80:
		return "Crime"

	case 99:
		return "Documentary"

	case 18:
		return "Drama"

	case 10751:
		return "Family"

	case 14:
		return "Fantasy"

	case 36:
		return "History"

	case 27:
		return "Horror"

	case 10402:
		return "Music"

	case 9648:
		return "Mystery"

	case 10749:
		return "Romance"

	case 878:
		return "Science Fiction"

	case 10770:
		return "TV Movie"

	case 53:
		return "Thriller"

	case 10752:
		return "War"

	case 37:
		return "Western"

	default:
		return ""

	}

}

/* =========================================================
   FIND YOUTUBE TRAILER
   ========================================================= */

func findDashboardTrailer(
	details *tmdb.MovieDetails,
) string {

	if details == nil ||
		details.MovieVideosAppend == nil ||
		details.Videos == nil ||
		details.Videos.MovieVideosResults == nil {

		return ""

	}

	/*
	   Prefer official YouTube trailers.
	*/

	for _, video := range details.Videos.Results {

		if video == nil {

			continue

		}

		if video.Site != "YouTube" {

			continue

		}

		if video.Key == "" {

			continue

		}

		if video.Type == "Trailer" &&
			video.Official {

			return tmdb.GetVideoURL(
				video.Key,
			)

		}

	}

	/*
	   Fallback to a non-official YouTube
	   trailer when no official one exists.
	*/

	for _, video := range details.Videos.Results {

		if video == nil {

			continue

		}

		if video.Site != "YouTube" {

			continue

		}

		if video.Key == "" {

			continue

		}

		if video.Type == "Trailer" {

			return tmdb.GetVideoURL(
				video.Key,
			)

		}

	}

	return ""

}
