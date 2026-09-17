package main

import (
	"MoviPilot/funcs/API"
	"MoviPilot/funcs/form"
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
		"templates/signup.html",
		"templates/login.html",
		"templates/forgot-password.html",
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
	var isTrending bool

	if query != "" {

		title = fmt.Sprintf("Search Results for: '%s'", query)

		movies, err = API.SearchMovies(query)
		isTrending = false

	} else {

		title = "Trending Today"

		movies, err = API.GetTrendingMovies()

		isTrending = true
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
		PageTitle:  title,
		Movies:     movies,
		IsTrending: isTrending,
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

	// Get the movie the user clicked
	movie, err := tmdbClient.GetMovieDetails(
		movieID,
		map[string]string{
			"language": "en-US",
		},
	)

	if err != nil {
		http.Error(
			w,
			"Error fetching movie details: "+err.Error(),
			http.StatusInternalServerError,
		)
		return
	}

	// Get recommendations based on that movie
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

	// Create a dynamic page title
	pageTitle := fmt.Sprintf(
		`You clicked on "%s", so we recommend:`,
		movie.Title,
	)

	data := API.PageData{
		PageTitle:  pageTitle,
		Movies:     recommendations,
		IsTrending: false,
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

func SignupHandler(w http.ResponseWriter, r *http.Request) {

	// GET → show signup page
	if r.Method == http.MethodGet {
		err := renderTemplate(w, "signup.html", nil)

		if err != nil {
			http.Error(w, "404 : Page Not Found", http.StatusNotFound)
			return
		}

		return
	}

	// Only POST is allowed after this point
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	type SignupPageData struct {
		FullName             string
		Email                string
		FullNameError        string
		EmailError           string
		PasswordError        string
		ConfirmPasswordError string
		TermsError           string
		TermsAccepted        bool
	}

	fullName := r.FormValue("fullname")
	email := r.FormValue("email")
	password := r.FormValue("password")
	confirmPassword := r.FormValue("confirmPassword")
	terms := r.FormValue("terms")

	var data SignupPageData
	var hasError bool

	// NAME
	validName, err := form.ValidateName(fullName)

	if err != nil {
		data.FullName = fullName
		data.FullNameError = err.Error()
		hasError = true
	} else {
		data.FullName = validName
	}

	// EMAIL
	validEmail, err := form.ValidateEmail(email)

	if err != nil {
		data.Email = email
		data.EmailError = err.Error()
		hasError = true
	} else {
		data.Email = validEmail
	}

	// PASSWORD
	_, err = form.ValidatePassword(password)

	if err != nil {
		data.PasswordError = err.Error()
		hasError = true
	}

	// CONFIRM PASSWORD
	err = form.ValidatePasswordMatch(password, confirmPassword)

	if err != nil {
		data.ConfirmPasswordError = err.Error()
		hasError = true
	}

	// TERMS
	err = form.ValidateTerms(terms)

	if err != nil {
		data.TermsError = err.Error()
		hasError = true
	} else {
		data.TermsAccepted = true
	}

	// STOP HERE IF VALIDATION FAILED
	if hasError {
		err := renderTemplate(w, "signup.html", data)

		if err != nil {
			http.Error(w, "500 : Failed to render signup page", http.StatusInternalServerError)
		}

		return
	}

	// If we reach here, every field passed validation.
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	err := renderTemplate(w, "login.html", nil)
	if err != nil {
		http.Error(w, "404 : Page Not Found", http.StatusNotFound)
		return
	}
}

func ForgotPasswordHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	err := renderTemplate(w, "forgot-password.html", nil)
	if err != nil {
		http.Error(w, "404 : Page Not Found", http.StatusNotFound)
		return
	}
}
