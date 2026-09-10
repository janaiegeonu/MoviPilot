package API

import (
	"html/template"

	"github.com/benlei/go-tmdb/v2"
)

const tmdbToken = "4b219f39bcc74d2bc3b1b077c439a7ea"

type MovieInfo struct {
	ID          int64
	Title       string
	ReleaseDate string
	Overview    string
	Rating      float32
	PosterURL   template.URL
}

type PageData struct {
	PageTitle  string
	IsTrending bool
	Movies     []MovieInfo
}

func GetTrendingMovies() ([]MovieInfo, error) {
	tmdbClient, err := tmdb.Init(tmdbToken)
	if err != nil {
		return nil, err
	}

	trendingResult, err := tmdbClient.GetTrending("movie", "day")
	if err != nil {
		return nil, err
	}

	var movies []MovieInfo

	for _, result := range trendingResult.Results {
		var posterPath string

		if result.PosterPath != "" {
			posterPath = tmdb.GetImageURL(result.PosterPath, tmdb.W500)
		}

		movies = append(movies, MovieInfo{
			ID:          result.ID,
			Title:       result.Title,
			ReleaseDate: result.ReleaseDate,
			Overview:    result.Overview,
			Rating:      result.VoteAverage,
			PosterURL:   template.URL(posterPath),
		})
	}

	return movies, nil
}

func SearchMovies(query string) ([]MovieInfo, error) {
	tmdbClient, err := tmdb.Init(tmdbToken)
	if err != nil {
		return nil, err
	}

	options := map[string]string{
		"language": "en-US",
	}

	searchResult, err := tmdbClient.GetSearchMovies(query, options)
	if err != nil {
		return nil, err
	}

	var movies []MovieInfo

	for _, result := range searchResult.Results {
		var posterPath string

		if result.PosterPath != "" {
			posterPath = tmdb.GetImageURL(result.PosterPath, tmdb.W500)
		}

		movies = append(movies, MovieInfo{
			ID:          result.ID,
			Title:       result.Title,
			ReleaseDate: result.ReleaseDate,
			Overview:    result.Overview,
			Rating:      result.VoteAverage,
			PosterURL:   template.URL(posterPath),
		})
	}

	return movies, nil
}
