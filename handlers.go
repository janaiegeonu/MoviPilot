package main

import (
	"MoviPilot/funcs/API"
	"MoviPilot/funcs/auth"
	"MoviPilot/funcs/form"
	"MoviPilot/funcs/storage"
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/benlei/go-tmdb/v2"
	"golang.org/x/crypto/bcrypt"
	"gopkg.in/mail.v2"
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

	// checking if email already exist in database
	exists, err := storage.EmailExists(email)

	if err != nil {
		http.Error(w, "Unable to check email", http.StatusInternalServerError)
		return
	}

	if exists {
		data.Email = email
		data.EmailError = "Email already registered to MoviPilot"
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

	hashedPassword, err := auth.HashPassword(password)
	if err != nil {
		http.Error(w, "Unable to process password", http.StatusInternalServerError)
		return
	}

	user := storage.User{
		FullName:     fullName,
		Email:        email,
		PasswordHash: hashedPassword,
	}

	err = storage.CreateUser(user)
	if err != nil {
		http.Error(w, "Unable to create account", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/login", http.StatusSeeOther)

}

type LoginPageData struct {
	Email         string
	PasswordError string
	EmailError    string
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {
		err := renderTemplate(w, "login.html", nil)

		if err != nil {
			http.Error(w, "500 : Failed to render login page", http.StatusInternalServerError)
		}

		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var data LoginPageData
	var hasError bool

	email := r.FormValue("email")
	password := r.FormValue("password")

	// EMAIL
	if email == "" {
		data.EmailError = "Email is required"
		hasError = true
	} else {
		data.Email = email
	}

	// PASSWORD
	if password == "" {
		data.PasswordError = "Password is required"
		hasError = true
	}

	// STOP HERE IF FORM VALIDATION FAILED
	if hasError {
		err := renderTemplate(w, "login.html", data)

		if err != nil {
			http.Error(w, "500 : Failed to render login page", http.StatusInternalServerError)
		}

		return
	}

	// FIND USER BY EMAIL
	user, err := storage.GetUserByEmail(email)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			data.Email = email
			data.PasswordError = "Invalid email or password"

			err := renderTemplate(w, "login.html", data)

			if err != nil {
				http.Error(w, "500 : Failed to render login page", http.StatusInternalServerError)
			}

			return
		}

		http.Error(w, "500 : Database error", http.StatusInternalServerError)
		return
	}

	// CHECK PASSWORD
	err = bcrypt.CompareHashAndPassword(
		[]byte(user.PasswordHash),
		[]byte(password),
	)

	if err != nil {
		data.Email = email
		data.PasswordError = "Invalid email or password"

		err := renderTemplate(w, "login.html", data)

		if err != nil {
			http.Error(w, "500 : Failed to render login page", http.StatusInternalServerError)
		}

		return
	}

	// Password is correct.
	// Session creation will come next.

	http.Redirect(w, r, "/home", http.StatusSeeOther)
}

type Forgetdata struct {
	Email       string
	EmailError  string
	EmailError1 string
}

func ForgotPasswordHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {
		err := renderTemplate(w, "forgot-password.html", nil)

		if err != nil {
			http.Error(w, "500 : Failed to render forgot-password page", http.StatusInternalServerError)
		}

		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var data Forgetdata
	var hasError bool
	var empty bool

	email := r.FormValue("email")

	if email == "" {
		data.EmailError1 = "Email is required"
		hasError = true
		empty = true
	}

	exists, err := storage.EmailExists(email)

	if err != nil {
		http.Error(w, "500 : Failed to check email", http.StatusInternalServerError)
		return
	}

	if !exists && !empty {
		data.Email = email
		data.EmailError = "Email not registered to MoviPilot"
		hasError = true
	}

	if hasError {
		err := renderTemplate(w, "forgot-password.html", data)

		if err != nil {
			http.Error(w, "500 : Failed to render forgot-password page", http.StatusInternalServerError)
		}

		return
	}

	verificationCode := auth.GenerateNumericCode()

	if verificationCode == "" {
		http.Error(w, "500 : Failed to generate verification code", http.StatusInternalServerError)
		return
	}

	hashedCode, err := bcrypt.GenerateFromPassword(
		[]byte(verificationCode),
		bcrypt.DefaultCost,
	)

	if err != nil {
		http.Error(w, "500 : Failed to secure verification code", http.StatusInternalServerError)
		return
	}
	expiresAt := time.Now().Add(10 * time.Minute)

	err = storage.SavePasswordResetCode(
		email,
		string(hashedCode),
		expiresAt,
	)

	if err != nil {
		fmt.Println("SAVE PASSWORD RESET CODE ERROR:", err)

		http.Error(
			w,
			"500 : Failed to save verification code",
			http.StatusInternalServerError,
		)
		return
	}

	type PasswordResetEmailData struct {
		Code string
	}

	// PREPARE EMAIL
	emailData := PasswordResetEmailData{
		Code: verificationCode,
	}

	tmpl, err := template.ParseFiles(
		"templates/emailcode.html",
	)

	if err != nil {
		http.Error(w, "500 : Failed to load email template", http.StatusInternalServerError)
		return
	}

	var bodyBuffer bytes.Buffer

	err = tmpl.Execute(&bodyBuffer, emailData)

	if err != nil {
		http.Error(w, "500 : Failed to create email", http.StatusInternalServerError)
		return
	}

	//sending code to mail
	m := mail.NewMessage()

	m.SetAddressHeader(
		"From",
		os.Getenv("BREVO_SENDER_EMAIL"),
		os.Getenv("BREVO_SENDER_NAME"),
	)
	m.SetHeader("To", email)
	m.SetHeader("Subject", "MoviPilot Verification Code")

	m.SetBody(
		"text/html",
		bodyBuffer.String(),
	)
	port, err := strconv.Atoi(os.Getenv("BREVO_SMTP_PORT"))

	if err != nil {
		http.Error(w, "Invalid SMTP port", http.StatusInternalServerError)
		return
	}

	d := mail.NewDialer(
		os.Getenv("BREVO_SMTP_HOST"),
		port,
		os.Getenv("BREVO_SMTP_LOGIN"),
		os.Getenv("BREVO_SMTP_KEY"),
	)
	err = d.DialAndSend(m)

	if err != nil {
		fmt.Println("EMAIL ERROR:", err)
		http.Error(w, "500 : Failed to send verification email", http.StatusInternalServerError)
		return
	}

}
