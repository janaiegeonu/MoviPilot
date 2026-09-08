package main

import (
	"MoviPilot/funcs/API"
	"fmt"
	"html/template"
	"net/http"
	"strconv"

	"github.com/benlei/go-tmdb/v2"
)

const tmdbToken = "4b219f39bcc74d2bc3b1b077c439a7ea"

func renderTemplate(w http.ResponseWriter, tmplName string, data interface{}) error {
	tmpl, err := template.ParseFiles(
		"templates/splash.html",
		"templates/homepage.html",
	)
	if err != nil {
		http.Error(
			w,
			"Template Parsing Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return err
	}

	err = tmpl.ExecuteTemplate(w, tmplName, data)
	if err != nil {
		http.Error(
			w,
			"Template Execution Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return err
	}

	return nil
}

func SplashIntro(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	err := renderTemplate(w, "splash.html", nil)
	if err != nil {
		http.Error(w, "404 : Page Not Found", http.StatusNotFound)
		return
	}
}

var templates = template.Must(
	template.ParseFiles("templates/homepage.html"),
)

func HomepageHandler(w http.ResponseWriter, r *http.Request) {

	query := r.URL.Query().Get("q")

	var movies []API.MovieInfo
	var err error
	var title string

	if query != "" {

		title = fmt.Sprintf("Search Results for: '%s'", query)

		movies, err = API.SearchMovies(query)

	} else {

		title = "🔥 Trending Today"

		movies, err = API.GetTrendingMovies()
	}

	if err != nil {
		http.Error(
			w,
			"Error fetching data: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}

	data := API.PageData{
		PageTitle: title,
		Movies:    movies,
	}

	err = templates.ExecuteTemplate(w, "homepage.html", data)
	if err != nil {
		http.Error(
			w,
			"Template Execution Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}
}

func MovieDetailHandler(w http.ResponseWriter, r *http.Request) {

	idStr := r.URL.Query().Get("id")

	movieID, err := strconv.ParseInt(idStr, 10, 64)

	if err != nil || idStr == "" {
		http.Error(
			w,
			"Invalid movie ID",
			http.StatusBadRequest,
		)
		return
	}

	tmdbClient, err := tmdb.Init(tmdbToken)

	if err != nil {
		http.Error(
			w,
			"Error initializing TMDb client: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}

	recResult, err := tmdbClient.GetMovieRecommendations(
		movieID,
		map[string]string{
			"language": "en-US",
		},
	)

	if err != nil {
		http.Error(
			w,
			"Error fetching recommendations: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}

	var recommendations []API.MovieInfo

	for _, result := range recResult.Results {

		var posterPath string

		if result.PosterPath != "" {
			posterPath = tmdb.GetImageURL(
				result.PosterPath,
				tmdb.W500,
			)
		}

		recommendations = append(
			recommendations,
			API.MovieInfo{
				ID:          result.ID,
				Title:       result.Title,
				ReleaseDate: result.ReleaseDate,
				Overview:    result.Overview,
				Rating:      result.VoteAverage,
				PosterURL:   template.URL(posterPath),
			},
		)
	}

	data := API.PageData{
		PageTitle: "🎯 Because You Clicked That Movie, We Recommend:",
		Movies:    recommendations,
	}

	err = templates.ExecuteTemplate(
		w,
		"homepage.html",
		data,
	)

	if err != nil {
		http.Error(
			w,
			"Template Execution Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}
}
