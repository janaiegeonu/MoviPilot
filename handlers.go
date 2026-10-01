package main

import (
	"MoviPilot/funcs/API"
	"MoviPilot/funcs/auth"
	"MoviPilot/funcs/form"
	"MoviPilot/funcs/storage"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
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
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gopkg.in/mail.v2"
)

func renderTemplate(w http.ResponseWriter, tmplName string, data interface{}) error {
	tmpl, err := template.ParseFiles(
		"templates/splash.html",
		"templates/homepage.html",
		"templates/signup.html",
		"templates/login.html",
		"templates/forgot-password.html",
		"templates/verifycode.html",
		"templates/reset-password.html",
		"templates/terms.html",
		"templates/policy.html",
		"templates/dashboard.html",
		"templates/series_page.html",
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

	tmdbToken := os.Getenv("TMDB_TOKEN")

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

	type WelcomeEmailData struct {
		FullName string
		HomeURL  string
		Year     int
	}

	tmpl, err := template.ParseFiles(
		"templates/welcomeEmail.html",
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE PARSE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to load email template",
			http.StatusInternalServerError,
		)

		return
	}

	emailData := WelcomeEmailData{
		FullName: fullName,
		HomeURL:  "http://localhost:8080/homepage",
		Year:     time.Now().Year(),
	}

	var bodyBuffer bytes.Buffer

	err = tmpl.Execute(
		&bodyBuffer,
		emailData,
	)

	m := mail.NewMessage()

	m.SetAddressHeader(
		"From",
		os.Getenv("BREVO_SENDER_EMAIL"),
		os.Getenv("BREVO_SENDER_NAME"),
	)

	m.SetHeader(
		"To",
		email,
	)

	m.SetHeader(
		"Subject",
		"Welcome to MoviPilot — Your Personal Movie Compass",
	)

	m.SetBody(
		"text/html",
		bodyBuffer.String(),
	)
	port, _ := strconv.Atoi(
		os.Getenv("BREVO_SMTP_PORT"),
	)

	d := mail.NewDialer(
		os.Getenv("BREVO_SMTP_HOST"),
		port,
		os.Getenv("BREVO_SMTP_LOGIN"),
		os.Getenv("BREVO_SMTP_KEY"),
	)

	err = d.DialAndSend(m)

	http.Redirect(w, r, "/login", http.StatusSeeOther)

}

//=================
//Google OAuth Handlers
//=================

const (
	googleStateCookie    = "movipilot_google_state"
	googleVerifierCookie = "movipilot_google_verifier"
	googleModeCookie     = "movipilot_google_mode"

	googleUserInfoURL = "https://openidconnect.googleapis.com/v1/userinfo"
)

type GoogleUserInfo struct {
	Sub           string `json:"sub"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

func getGoogleOAuthConfig() (*oauth2.Config, error) {

	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")

	if clientID == "" || clientSecret == "" {
		return nil, fmt.Errorf("Google OAuth environment variables are missing")
	}

	baseURL := os.Getenv("MOVIPILOT_BASE_URL")

	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  strings.TrimRight(baseURL, "/") + "/auth/google/callback",

		Scopes: []string{
			"openid",
			"profile",
			"email",
		},
	}, nil
}

func randomOAuthValue(size int) (string, error) {

	buffer := make([]byte, size)

	_, err := rand.Read(buffer)
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func GoogleSignupHandler(w http.ResponseWriter, r *http.Request) {
	startGoogleAuth(w, r, "signup")

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	config, err := getGoogleOAuthConfig()
	if err != nil {
		http.Error(
			w,
			"Google authentication is not configured",
			http.StatusInternalServerError,
		)
		return
	}

	// Random state protects the OAuth flow against CSRF.
	state, err := randomOAuthValue(32)
	if err != nil {
		http.Error(
			w,
			"Unable to start Google authentication",
			http.StatusInternalServerError,
		)
		return
	}

	// PKCE verifier protects the authorization-code exchange.
	verifier := oauth2.GenerateVerifier()

	secure := r.TLS != nil

	http.SetCookie(w, &http.Cookie{
		Name:     googleStateCookie,
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	http.SetCookie(w, &http.Cookie{
		Name:     googleVerifierCookie,
		Value:    verifier,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	authURL := config.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	)

	http.Redirect(
		w,
		r,
		authURL,
		http.StatusFound,
	)
}

func GoogleLoginHandler(w http.ResponseWriter, r *http.Request) {
	startGoogleAuth(w, r, "login")
}

func startGoogleAuth(w http.ResponseWriter, r *http.Request, mode string) {

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	if mode != "signup" && mode != "login" {
		http.Error(
			w,
			"Invalid Google authentication mode",
			http.StatusBadRequest,
		)
		return
	}

	config, err := getGoogleOAuthConfig()
	if err != nil {
		http.Error(
			w,
			"Google authentication is not configured",
			http.StatusInternalServerError,
		)
		return
	}

	// Random state protects the OAuth flow against CSRF.
	state, err := randomOAuthValue(32)
	if err != nil {
		http.Error(
			w,
			"Unable to start Google authentication",
			http.StatusInternalServerError,
		)
		return
	}

	// PKCE verifier protects the authorization-code exchange.
	verifier := oauth2.GenerateVerifier()

	secure := r.TLS != nil

	// Store state.
	http.SetCookie(w, &http.Cookie{
		Name:     googleStateCookie,
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	// Store PKCE verifier.
	http.SetCookie(w, &http.Cookie{
		Name:     googleVerifierCookie,
		Value:    verifier,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	// Remember whether this came from signup or login.
	http.SetCookie(w, &http.Cookie{
		Name:     googleModeCookie,
		Value:    mode,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	authURL := config.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam(
			"prompt",
			"select_account",
		),
	)

	http.Redirect(
		w,
		r,
		authURL,
		http.StatusFound,
	)
}

func GoogleCallbackHandler(w http.ResponseWriter, r *http.Request) {

	config, err := getGoogleOAuthConfig()
	if err != nil {
		http.Error(
			w,
			"Google authentication is not configured",
			http.StatusInternalServerError,
		)
		return
	}

	stateCookie, err := r.Cookie(googleStateCookie)
	if err != nil {
		http.Error(
			w,
			"Google authentication session expired",
			http.StatusBadRequest,
		)
		return
	}

	verifierCookie, err := r.Cookie(googleVerifierCookie)
	if err != nil {
		http.Error(
			w,
			"Google authentication session expired",
			http.StatusBadRequest,
		)
		return
	}

	modeCookie, err := r.Cookie(googleModeCookie)
	if err != nil {
		http.Error(
			w,
			"Google authentication session expired",
			http.StatusBadRequest,
		)
		return
	}

	mode := modeCookie.Value

	if mode != "signup" && mode != "login" {
		http.Error(
			w,
			"Invalid Google authentication mode",
			http.StatusBadRequest,
		)
		return
	}

	// Always remove these cookies after receiving the callback.
	clearGoogleOAuthCookies(w, r)

	// Google can return an OAuth error when the user cancels.
	if googleError := r.URL.Query().Get("error"); googleError != "" {

		if googleError == "access_denied" {
			http.Redirect(
				w,
				r,
				"/signup?google=cancelled",
				http.StatusSeeOther,
			)
			return
		}

		http.Error(
			w,
			"Google authentication failed",
			http.StatusBadRequest,
		)
		return
	}

	returnedState := r.URL.Query().Get("state")

	if returnedState == "" {
		http.Error(
			w,
			"Invalid Google authentication response",
			http.StatusBadRequest,
		)
		return
	}

	// Constant-time comparison.
	if subtle.ConstantTimeCompare(
		[]byte(returnedState),
		[]byte(stateCookie.Value),
	) != 1 {

		http.Error(
			w,
			"Invalid Google authentication state",
			http.StatusBadRequest,
		)
		return
	}

	code := r.URL.Query().Get("code")

	if code == "" {
		http.Error(
			w,
			"Google authorization code is missing",
			http.StatusBadRequest,
		)
		return
	}

	ctx, cancel := context.WithTimeout(
		r.Context(),
		15*time.Second,
	)

	defer cancel()

	// Exchange authorization code for access token.
	token, err := config.Exchange(
		ctx,
		code,
		oauth2.VerifierOption(verifierCookie.Value),
	)

	if err != nil {
		fmt.Println("GOOGLE TOKEN EXCHANGE ERROR:", err)

		http.Error(
			w,
			"Unable to complete Google authentication",
			http.StatusInternalServerError,
		)
		return
	}

	// Create HTTP client using the Google access token.
	client := config.Client(ctx, token)

	response, err := client.Get(googleUserInfoURL)
	if err != nil {
		fmt.Println("GOOGLE USERINFO ERROR:", err)

		http.Error(
			w,
			"Unable to retrieve Google account",
			http.StatusInternalServerError,
		)
		return
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {

		http.Error(
			w,
			"Google account information could not be retrieved",
			http.StatusInternalServerError,
		)
		return
	}

	var googleUser GoogleUserInfo

	err = json.NewDecoder(response.Body).Decode(&googleUser)
	if err != nil {

		http.Error(
			w,
			"Invalid Google account information",
			http.StatusInternalServerError,
		)
		return
	}

	googleUser.Sub = strings.TrimSpace(googleUser.Sub)
	googleUser.Name = strings.TrimSpace(googleUser.Name)
	googleUser.Email = strings.ToLower(
		strings.TrimSpace(googleUser.Email),
	)

	if googleUser.Sub == "" ||
		googleUser.Name == "" ||
		googleUser.Email == "" {

		http.Error(
			w,
			"Google did not provide the required account information",
			http.StatusBadRequest,
		)
		return
	}

	// We only accept a verified Google email.
	if !googleUser.EmailVerified {

		http.Error(
			w,
			"Your Google email address is not verified",
			http.StatusForbidden,
		)
		return
	}

	/*
		Check whether this exact Google account already exists.

		Google's "sub" is the stable identifier.
	*/
	user, err := storage.GetUserByGoogleID(
		googleUser.Sub,
	)

	// --------------------------------------------------
	// GOOGLE ACCOUNT ALREADY EXISTS
	// --------------------------------------------------

	if err == nil {

		sessionID, err := storage.CreateSession(user.ID)
		if err != nil {
			http.Error(
				w,
				"Unable to create login session",
				http.StatusInternalServerError,
			)
			return
		}

		setLoginCookie(
			w,
			r,
			sessionID,
		)

		http.Redirect(
			w,
			r,
			"/dashboard",
			http.StatusSeeOther,
		)

		return
	}

	// --------------------------------------------------
	// GOOGLE DATABASE LOOKUP FAILED
	// --------------------------------------------------

	if err != sql.ErrNoRows {

		fmt.Println(
			"GOOGLE USER LOOKUP ERROR:",
			err,
		)

		http.Error(
			w,
			"Unable to check Google account",
			http.StatusInternalServerError,
		)

		return
	}

	// --------------------------------------------------
	// GOOGLE ACCOUNT DOES NOT EXIST
	// --------------------------------------------------

	// If this came from LOGIN, don't create an account.
	if mode == "login" {

		http.Redirect(
			w,
			r,
			"/login?google=not_registered",
			http.StatusSeeOther,
		)

		return
	}

	// --------------------------------------------------
	// SIGNUP MODE
	// --------------------------------------------------

	existingUser, err := storage.GetUserByEmail(
		googleUser.Email,
	)

	if err == nil {

		// This email already belongs to a normal MoviPilot account.
		if existingUser.AuthProvider == "local" {

			http.Redirect(
				w,
				r,
				"/login?google=existing",
				http.StatusSeeOther,
			)

			return
		}

		http.Redirect(
			w,
			r,
			"/login",
			http.StatusSeeOther,
		)

		return
	}

	if err != sql.ErrNoRows {

		fmt.Println(
			"EMAIL LOOKUP ERROR:",
			err,
		)

		http.Error(
			w,
			"Unable to check account email",
			http.StatusInternalServerError,
		)

		return
	}

	// --------------------------------------------------
	// CREATE GOOGLE USER
	// --------------------------------------------------

	err = storage.CreateGoogleUser(
		googleUser.Name,
		googleUser.Email,
		googleUser.Sub,
	)

	if err != nil {

		fmt.Println(
			"GOOGLE USER CREATION ERROR:",
			err,
		)

		http.Error(
			w,
			"Unable to create MoviPilot account",
			http.StatusInternalServerError,
		)

		return
	}

	// --------------------------------------------------
	// LOAD NEW USER
	// --------------------------------------------------

	user, err = storage.GetUserByGoogleID(
		googleUser.Sub,
	)

	if err != nil {

		fmt.Println(
			"GOOGLE USER RELOAD ERROR:",
			err,
		)

		http.Error(
			w,
			"Account was created but could not be loaded",
			http.StatusInternalServerError,
		)

		return
	}

	// --------------------------------------------------
	// SEND WELCOME EMAIL
	// --------------------------------------------------

	type WelcomeEmailData struct {
		FullName string
		HomeURL  string
		Year     int
	}

	tmpl, err := template.ParseFiles(
		"templates/welcomeEmail.html",
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE PARSE ERROR:",
			err,
		)

		// Account was already created, so don't delete
		// or invalidate the account just because the email failed.
	} else {

		emailData := WelcomeEmailData{
			FullName: googleUser.Name,
			HomeURL:  "http://localhost:8080/homepage",
			Year:     time.Now().Year(),
		}

		var bodyBuffer bytes.Buffer

		err = tmpl.Execute(
			&bodyBuffer,
			emailData,
		)

		if err != nil {

			fmt.Println(
				"EMAIL TEMPLATE EXECUTION ERROR:",
				err,
			)

		} else {

			m := mail.NewMessage()

			m.SetAddressHeader(
				"From",
				os.Getenv("BREVO_SENDER_EMAIL"),
				os.Getenv("BREVO_SENDER_NAME"),
			)

			m.SetHeader(
				"To",
				googleUser.Email,
			)

			m.SetHeader(
				"Subject",
				"Welcome to MoviPilot — Your Personal Movie Compass",
			)

			m.SetBody(
				"text/html",
				bodyBuffer.String(),
			)

			port, err := strconv.Atoi(
				os.Getenv("BREVO_SMTP_PORT"),
			)

			if err != nil {

				fmt.Println(
					"SMTP PORT ERROR:",
					err,
				)

			} else {

				d := mail.NewDialer(
					os.Getenv("BREVO_SMTP_HOST"),
					port,
					os.Getenv("BREVO_SMTP_LOGIN"),
					os.Getenv("BREVO_SMTP_KEY"),
				)

				err = d.DialAndSend(m)

				if err != nil {

					fmt.Println(
						"WELCOME EMAIL SEND ERROR:",
						err,
					)

				} else {

					fmt.Println(
						"Welcome email sent successfully to:",
						googleUser.Email,
					)
				}
			}
		}
	}

	// --------------------------------------------------
	// CREATE MOVIPILOT SESSION
	// --------------------------------------------------

	sessionID, err := storage.CreateSession(
		user.ID,
	)

	if err != nil {

		http.Error(
			w,
			"Unable to create login session",
			http.StatusInternalServerError,
		)

		return
	}

	setLoginCookie(
		w,
		r,
		sessionID,
	)

	// --------------------------------------------------
	// GOOGLE SIGNUP COMPLETE
	// --------------------------------------------------

	http.Redirect(
		w,
		r,
		"/dashboard",
		http.StatusSeeOther,
	)

}

func clearGoogleOAuthCookies(w http.ResponseWriter, r *http.Request) {

	secure := r.TLS != nil

	http.SetCookie(w, &http.Cookie{
		Name:     googleStateCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	http.SetCookie(w, &http.Cookie{
		Name:     googleVerifierCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})

	http.SetCookie(w, &http.Cookie{
		Name:     googleModeCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func setLoginCookie(
	w http.ResponseWriter,
	r *http.Request,
	sessionID string,
) {

	secure := r.TLS != nil

	http.SetCookie(w, &http.Cookie{
		Name:     "movipilot_session",
		Value:    sessionID,
		Path:     "/",
		MaxAge:   7 * 24 * 60 * 60,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func TermsHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	err := renderTemplate(
		w,
		"terms.html",
		nil,
	)

	if err != nil {
		http.Error(
			w,
			"500 : Failed to render Terms of Service",
			http.StatusInternalServerError,
		)
		return
	}
}

func PrivacyPolicyHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	err := renderTemplate(
		w,
		"policy.html",
		nil,
	)

	if err != nil {
		http.Error(
			w,
			"500 : Failed to render Privacy Policy",
			http.StatusInternalServerError,
		)
		return
	}
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

type VerificationPageData struct {
	Email string
}

/* =========================================================
   FORGOT PASSWORD HANDLER
   ========================================================= */

func ForgotPasswordHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {

		err := renderTemplate(
			w,
			"forgot-password.html",
			nil,
		)

		if err != nil {
			http.Error(
				w,
				"500 : Failed to render forgot-password page",
				http.StatusInternalServerError,
			)
		}

		return
	}

	if r.Method != http.MethodPost {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	email := strings.TrimSpace(
		r.FormValue("email"),
	)

	/* -----------------------------------------------------
	   1. CHECK EMPTY EMAIL
	   ----------------------------------------------------- */

	if email == "" {

		w.WriteHeader(http.StatusBadRequest)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "email",
			"error":   "Email is required",
		})

		return
	}

	/* -----------------------------------------------------
	   2. CHECK IF EMAIL EXISTS
	   ----------------------------------------------------- */

	exists, err := storage.EmailExists(email)

	if err != nil {

		fmt.Println(
			"EMAIL EXISTS CHECK ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to check email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   3. EMAIL DOES NOT EXIST
	   ----------------------------------------------------- */

	if !exists {

		w.WriteHeader(http.StatusBadRequest)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "email",
			"error":   "Email not registered to MoviPilot",
		})

		return
	}

	/* -----------------------------------------------------
	   4. GENERATE 6-DIGIT CODE
	   ----------------------------------------------------- */

	verificationCode := auth.GenerateNumericCode()

	if verificationCode == "" {

		http.Error(
			w,
			"500 : Failed to generate verification code",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   5. HASH VERIFICATION CODE
	   ----------------------------------------------------- */

	hashedCode, err := bcrypt.GenerateFromPassword(
		[]byte(verificationCode),
		bcrypt.DefaultCost,
	)

	if err != nil {

		http.Error(
			w,
			"500 : Failed to secure verification code",
			http.StatusInternalServerError,
		)

		return
	}

	expiresAt := time.Now().Add(
		10 * time.Minute,
	)

	/* -----------------------------------------------------
	   6. SAVE CODE TO DATABASE
	   ----------------------------------------------------- */

	err = storage.SavePasswordResetCode(
		email,
		string(hashedCode),
		expiresAt,
	)

	if err != nil {

		fmt.Println(
			"SAVE PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to save verification code",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   7. PREPARE EMAIL
	   ----------------------------------------------------- */

	type PasswordResetEmailData struct {
		VerificationCode string
		CopyCodeURL      string
		Year             int
	}

	emailData := PasswordResetEmailData{
		VerificationCode: verificationCode,
		CopyCodeURL:      "http://localhost:8080/copy-code",
		Year:             time.Now().Year(),
	}

	tmpl, err := template.ParseFiles(
		"templates/emailcode.html",
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE PARSE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to load email template",
			http.StatusInternalServerError,
		)

		return
	}

	var bodyBuffer bytes.Buffer

	err = tmpl.Execute(
		&bodyBuffer,
		emailData,
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE EXECUTION ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to create email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   8. CREATE EMAIL
	   ----------------------------------------------------- */

	m := mail.NewMessage()

	m.SetAddressHeader(
		"From",
		os.Getenv("BREVO_SENDER_EMAIL"),
		os.Getenv("BREVO_SENDER_NAME"),
	)

	m.SetHeader(
		"To",
		email,
	)

	m.SetHeader(
		"Subject",
		"MoviPilot Verification Code",
	)

	m.SetBody(
		"text/html",
		bodyBuffer.String(),
	)

	/* -----------------------------------------------------
	   9. SMTP
	   ----------------------------------------------------- */

	port, err := strconv.Atoi(
		os.Getenv("BREVO_SMTP_PORT"),
	)

	if err != nil {

		http.Error(
			w,
			"Invalid SMTP port",
			http.StatusInternalServerError,
		)

		return
	}

	d := mail.NewDialer(
		os.Getenv("BREVO_SMTP_HOST"),
		port,
		os.Getenv("BREVO_SMTP_LOGIN"),
		os.Getenv("BREVO_SMTP_KEY"),
	)

	/* -----------------------------------------------------
	   10. SEND EMAIL
	   ----------------------------------------------------- */

	err = d.DialAndSend(m)

	if err != nil {

		fmt.Println(
			"EMAIL ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to send verification email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   11. KEEP THE EMAIL IN THE RESET FLOW

	   The verification page reads this HttpOnly cookie
	   so the page can know which account the code belongs to.
	   ----------------------------------------------------- */

	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "movipilot_reset_email",
			Value:    email,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   10 * 60,
		},
	)

	/* -----------------------------------------------------
	   12. SUCCESS

	   The existing forgot-password JavaScript should use
	   this JSON response to navigate to /verify-code.
	   ----------------------------------------------------- */

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"redirect": "/verify-code",
	})
}

/* =========================================================
   VERIFICATION CODE HANDLER
   ========================================================= */

func VerificationCodeHandler(w http.ResponseWriter, r *http.Request) {

	// ============================================
	// GET
	// ============================================

	if r.Method == http.MethodGet {

		resetCookie, err := r.Cookie(
			"movipilot_reset_email",
		)

		if err != nil ||
			strings.TrimSpace(resetCookie.Value) == "" {

			http.Redirect(
				w,
				r,
				"/forgot-password",
				http.StatusSeeOther,
			)

			return
		}

		email := strings.ToLower(
			strings.TrimSpace(resetCookie.Value),
		)

		pageData := VerificationPageData{
			Email: email,
		}

		err = renderTemplate(
			w,
			"verifycode.html",
			pageData,
		)

		if err != nil {

			fmt.Println(
				"VERIFY PAGE RENDER ERROR:",
				err,
			)

			http.Error(
				w,
				"500 : Failed to render verifycode page",
				http.StatusInternalServerError,
			)
		}

		return
	}

	// ============================================
	// POST ONLY
	// ============================================

	if r.Method != http.MethodPost {

		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)

		return
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	// ============================================
	// 1. GET EMAIL FROM RESET COOKIE
	// ============================================

	resetCookie, err := r.Cookie(
		"movipilot_reset_email",
	)

	if err != nil ||
		strings.TrimSpace(resetCookie.Value) == "" {

		w.WriteHeader(
			http.StatusUnauthorized,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Your verification session has expired. Please request a new code.",
		})

		return
	}

	email := strings.ToLower(
		strings.TrimSpace(resetCookie.Value),
	)

	// ============================================
	// 2. GET SIX DIGIT CODE
	// ============================================

	code := strings.TrimSpace(
		r.FormValue("verification_code"),
	)

	// ============================================
	// 3. VALIDATE CODE FORMAT
	// ============================================

	if !auth.IsSixDigitCode(code) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "verification_code",
			"error":   "Please enter the 6-digit verification code.",
		})

		return
	}

	// ============================================
	// 4. GET HASH FROM DATABASE
	// ============================================

	hashedCode, expiresAt, err :=
		storage.GetPasswordResetCode(email)

	// No row exists
	if errors.Is(err, sql.ErrNoRows) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "This verification code is invalid or has expired.",
		})

		return
	}

	// Real database error
	if err != nil {

		fmt.Println(
			"GET PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to retrieve verification code",
			http.StatusInternalServerError,
		)

		return
	}

	// ============================================
	// 5. CHECK EXPIRY
	// ============================================

	if time.Now().After(expiresAt) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "This verification code has expired. Please request a new code.",
		})

		return
	}

	// ============================================
	// 6. COMPARE CODE WITH BCRYPT HASH
	// ============================================

	compareErr := bcrypt.CompareHashAndPassword(
		[]byte(hashedCode),
		[]byte(code),
	)

	if compareErr != nil {

		fmt.Println(
			"VERIFY BCRYPT ERROR:",
			compareErr,
		)

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "The verification code is incorrect.",
		})

		return
	}

	// ============================================
	// 7. VALID CODE
	// ============================================

	err = storage.DeletePasswordResetCode(
		email,
	)

	if err != nil {

		fmt.Println(
			"DELETE PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to complete verification",
			http.StatusInternalServerError,
		)

		return
	}

	// ============================================
	// 8. MARK RESET FLOW AS VERIFIED
	// ============================================

	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "movipilot_reset_verified",
			Value:    email,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   10 * 60,
		},
	)

	// ============================================
	// 9. SUCCESS
	// ============================================

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"redirect": "/reset-password",
	})
}

func ResetPasswordHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {

		verifiedCookie, err := r.Cookie("movipilot_reset_verified")

		if err != nil || strings.TrimSpace(verifiedCookie.Value) == "" {
			http.Redirect(w, r, "/forgot-password", http.StatusSeeOther)
			return
		}

		email := strings.ToLower(strings.TrimSpace(verifiedCookie.Value))

		err = renderTemplate(
			w,
			"reset-password.html",
			ResetPasswordPageData{Email: email},
		)

		if err != nil {
			fmt.Println("RESET PASSWORD PAGE RENDER ERROR:", err)
			http.Error(w, "500 : Failed to render reset password page", http.StatusInternalServerError)
		}

		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	verifiedCookie, err := r.Cookie("movipilot_reset_verified")
	if err != nil || strings.TrimSpace(verifiedCookie.Value) == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Your password reset session has expired. Please start the recovery process again.",
		})
		return
	}

	email := strings.ToLower(strings.TrimSpace(verifiedCookie.Value))

	password := r.FormValue("password")
	confirmPassword := r.FormValue("confirm_password")

	if _, err := form.ValidatePassword(password); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "password",
			"error":   err.Error(),
		})
		return
	}

	if err := form.ValidatePasswordMatch(password, confirmPassword); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "confirm_password",
			"error":   err.Error(),
		})
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte(password),
		bcrypt.DefaultCost,
	)
	if err != nil {
		fmt.Println("RESET PASSWORD HASH ERROR:", err)
		http.Error(w, "500 : Failed to secure new password", http.StatusInternalServerError)
		return
	}

	if err := storage.UpdateUserPassword(email, string(passwordHash)); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "Account could not be found.",
			})
			return
		}

		fmt.Println("UPDATE USER PASSWORD ERROR:", err)
		http.Error(w, "500 : Failed to update password", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "movipilot_reset_verified",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	http.SetCookie(w, &http.Cookie{
		Name:     "movipilot_reset_email",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"redirect": "/login",
	})
}

type ResetPasswordPageData struct {
	Email string
}

/* =========================================================
   MOVIPILOT DASHBOARD DATA
   ---------------------------------------------------------
   Dashboard homepage backend:

   1. Trending Today Hero
   2. Movies You May Like
   3. Top Rated Movies
   4. Popular Movie Trailers
   ========================================================= */

/* =========================================================
   DASHBOARD TEMPLATE DATA
   ========================================================= */

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

	/* =====================================================
	   TMDB API KEY
	   ===================================================== */

	apiKey :=
		strings.TrimSpace(
			os.Getenv("TMDB_TOKEN"),
		)

	if apiKey == "" {

		http.Error(
			w,
			"TMDB_TOKEN is not configured",
			http.StatusInternalServerError,
		)

		return
	}

	/* =====================================================
	   INITIALIZE TMDB CLIENT
	   ===================================================== */

	tmdbClient, err :=
		tmdb.Init(apiKey)

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

	/*
	   Let the wrapper retry 429 responses.
	*/

	tmdbClient.SetClientAutoRetry()

	/*
	   Don't allow a single slow TMDB request
	   to hang the dashboard forever.
	*/

	tmdbClient.SetClientConfig(
		&http.Client{
			Timeout: 12 * time.Second,
		},
	)

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
	   RENDER DASHBOARD
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

/* =========================================================
   SERIES CONSTANTS
   ========================================================= */

const (

	// Default Series page.
	seriesDefaultLimit = 66

	// Filtered collections.
	seriesFilterLimit = 48

	// Candidate pages.

	// 8 pages x 20 results can provide up to 160 candidates.
	seriesDefaultCandidatePages = 8

	// 7 pages x 20 results can provide up to 140 candidates.
	seriesFilterCandidatePages = 7

	// Controlled concurrent detail requests.
	seriesDetailWorkers = 5

	// Cache durations.
	seriesListCacheTTL   = 5 * time.Minute
	seriesDetailCacheTTL = 15 * time.Minute

	// Progressive enrichment batch.
	seriesEnrichmentBatchSize = 24

	// Candidate ceiling.
	seriesDefaultMaxCandidates = 160
	seriesFilterMaxCandidates  = 140
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
			"Could not load Series template",
			http.StatusInternalServerError,
		)

		return
	}

	err =
		tmpl.ExecuteTemplate(
			w,
			"series_cards",
			SeriesPageData{
				Shows: shows,
			},
		)

	if err != nil {

		http.Error(
			w,
			"Could not render Series cards",
			http.StatusInternalServerError,
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
		Support both variable names so the Series page
		works with your existing project configuration.
	*/

	apiKey :=
		strings.TrimSpace(
			os.Getenv("TMDB_TOKEN"),
		)

	if apiKey == "" {

		apiKey =
			strings.TrimSpace(
				os.Getenv("TMDB_TOKEN"),
			)

	}

	if apiKey == "" {

		return nil, errors.New(
			"TMDB API key is missing",
		)

	}

	client, err :=
		tmdb.Init(apiKey)

	if err != nil {

		return nil, err

	}

	/*
		Your chosen go-tmdb wrapper supports automatic retry
		for TMDB 429 responses.
	*/

	client.SetClientAutoRetry()

	client.SetClientConfig(
		&http.Client{
			Timeout: 12 * time.Second,
		},
	)

	return client, nil

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

	/*
		Cache the finished collection.
	*/

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

	/* =====================================================
	   ALL SERIES
	   ===================================================== */

	case "all":

		options :=
			map[string]string{

				"language": "en-US",

				"sort_by": "popularity.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesDefaultCandidatePages,
			seriesDefaultMaxCandidates,
		)

	/* =====================================================
	   NEW SERIES

	   Last 12 months.
	   ===================================================== */

	case "new":

		now :=
			time.Now().UTC()

		startDate :=
			now.AddDate(
				0,
				-12,
				0,
			).Format(
				"2006-01-02",
			)

		endDate :=
			now.Format(
				"2006-01-02",
			)

		options :=
			map[string]string{

				"language": "en-US",

				"first_air_date.gte": startDate,

				"first_air_date.lte": endDate,

				"sort_by": "first_air_date.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   UPCOMING SERIES

	   Next 18 months.
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

		options :=
			map[string]string{

				"language": "en-US",

				"first_air_date.gte": startDate,

				"first_air_date.lte": endDate,

				"sort_by": "first_air_date.asc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   TOP RATED
	   ===================================================== */

	case "top-rated":

		options :=
			map[string]string{

				"language": "en-US",

				"sort_by": "vote_average.desc",

				"vote_count.gte": "100",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   ACTION
	   ===================================================== */

	case "action":

		options :=
			map[string]string{

				"language": "en-US",

				"with_genres": "10759",

				"sort_by": "popularity.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   ANIME
	   ===================================================== */

	case "anime":

		options :=
			map[string]string{

				"language": "en-US",

				"with_genres": "16",

				"with_original_language": "ja",

				"sort_by": "popularity.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   HORROR

	   Uses TMDB keyword filtering first.

	   TMDB Discover supports with_keywords.
	   ===================================================== */

	case "horror":

		keywordID :=
			getSeriesKeywordID(
				client,
				"horror",
			)

		if keywordID > 0 {

			options :=
				map[string]string{

					"language": "en-US",

					"with_keywords": strconv.FormatInt(
						keywordID,
						10,
					),

					"sort_by": "popularity.desc",
				}

			seeds, err :=
				getDiscoverSeriesSeeds(
					client,
					options,
					seriesFilterCandidatePages,
					seriesFilterMaxCandidates,
				)

			if err != nil {

				return nil, err

			}

			/*
				If keyword results are too small, add a broader
				supernatural / mystery fallback.
			*/

			if len(seeds) >= 48 {

				return seeds, nil

			}

			fallback :=
				map[string]string{

					"language": "en-US",

					"with_genres": "9648|10765",

					"sort_by": "popularity.desc",
				}

			fallbackSeeds, fallbackErr :=
				getDiscoverSeriesSeeds(
					client,
					fallback,
					seriesFilterCandidatePages,
					seriesFilterMaxCandidates,
				)

			if fallbackErr != nil {

				return nil, fallbackErr

			}

			return mergeSeriesSeeds(
				seeds,
				fallbackSeeds,
				seriesFilterMaxCandidates,
			), nil

		}

		/*
			Keyword search unavailable:
			use Mystery + Sci-Fi/Fantasy as a broad fallback.
		*/

		options :=
			map[string]string{

				"language": "en-US",

				"with_genres": "9648|10765",

				"sort_by": "popularity.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
			seriesFilterCandidatePages,
			seriesFilterMaxCandidates,
		)

	/* =====================================================
	   ROMANCE
	   ===================================================== */

	case "romance":

		keywordID :=
			getSeriesKeywordID(
				client,
				"romance",
			)

		if keywordID > 0 {

			options :=
				map[string]string{

					"language": "en-US",

					"with_keywords": strconv.FormatInt(
						keywordID,
						10,
					),

					"sort_by": "popularity.desc",
				}

			seeds, err :=
				getDiscoverSeriesSeeds(
					client,
					options,
					seriesFilterCandidatePages,
					seriesFilterMaxCandidates,
				)

			if err != nil {

				return nil, err

			}

			if len(seeds) >= 48 {

				return seeds, nil

			}

			/*
				Fallback:
				Drama + Comedy + other common relationship-driven
				TV categories.
			*/

			fallback :=
				map[string]string{

					"language": "en-US",

					"with_genres": "18|35",

					"sort_by": "popularity.desc",
				}

			fallbackSeeds, fallbackErr :=
				getDiscoverSeriesSeeds(
					client,
					fallback,
					seriesFilterCandidatePages,
					seriesFilterMaxCandidates,
				)

			if fallbackErr != nil {

				return nil, fallbackErr

			}

			return mergeSeriesSeeds(
				seeds,
				fallbackSeeds,
				seriesFilterMaxCandidates,
			), nil

		}

		options :=
			map[string]string{

				"language": "en-US",

				"with_genres": "18|35",

				"sort_by": "popularity.desc",
			}

		return getDiscoverSeriesSeeds(
			client,
			options,
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

	results :=
		make([]seriesSeed, 0, maxCandidates)

	seen :=
		make(map[int64]bool)

	for page := 1; page <= pages; page++ {

		options :=
			make(map[string]string)

		for key, value := range baseOptions {

			options[key] =
				value

		}

		options["page"] =
			strconv.Itoa(page)

		response, err :=
			client.GetDiscoverTV(
				options,
			)

		if err != nil {

			return nil, err

		}

		if response == nil ||
			response.Results == nil {

			continue

		}

		for _, show := range response.Results {

			if show == nil ||
				show.ID == 0 {

				continue

			}

			if seen[show.ID] {

				continue

			}

			seen[show.ID] =
				true

			results =
				append(
					results,
					seriesSeed{

						ID: show.ID,

						Name: show.Name,

						FirstAirDate: show.FirstAirDate,

						PosterPath: show.PosterPath,

						GenreIDs: show.GenreIDs,

						VoteAverage: show.VoteAverage,
					},
				)

			if len(results) >=
				maxCandidates {

				return results, nil

			}

		}

	}

	return results, nil

}

/* =========================================================
   PROGRESSIVE DETAIL ENRICHMENT

   This is the main fix for the "only one card" problem.
   ========================================================= */

func enrichSeriesCandidatesUntilEnough(
	client *tmdb.Client,
	seeds []seriesSeed,
	limit int,
) []SeriesCard {

	if len(seeds) == 0 ||
		limit <= 0 {

		return []SeriesCard{}

	}

	finalCards :=
		make([]SeriesCard, 0, limit)

	for start := 0; start < len(seeds) &&
		len(finalCards) < limit; start += seriesEnrichmentBatchSize {

		end :=
			start + seriesEnrichmentBatchSize

		if end > len(seeds) {

			end =
				len(seeds)

		}

		batch :=
			seeds[start:end]

		batchCards :=
			enrichSeriesBatch(
				client,
				batch,
			)

		finalCards =
			append(
				finalCards,
				batchCards...,
			)

		if len(finalCards) >= limit {

			break

		}

	}

	if len(finalCards) >
		limit {

		finalCards =
			finalCards[:limit]

	}

	return finalCards

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

	workerCount :=
		seriesDetailWorkers

	if len(seeds) <
		workerCount {

		workerCount =
			len(seeds)

	}

	type batchResult struct {
		Index int

		Card SeriesCard

		Valid bool
	}

	jobs :=
		make(chan int)

	results :=
		make(chan batchResult,
			len(seeds),
		)

	var waitGroup sync.WaitGroup

	waitGroup.Add(
		workerCount,
	)

	/* =====================================================
	   WORKERS
	   ===================================================== */

	for i := 0; i < workerCount; i++ {

		go func() {

			defer waitGroup.Done()

			for index := range jobs {

				seed :=
					seeds[index]

				details, err :=
					getSeriesDetails(
						client,
						seed.ID,
					)

				if err != nil ||
					details == nil {

					results <- batchResult{
						Index: index,
						Valid: false,
					}

					continue

				}

				title :=
					strings.TrimSpace(
						details.Name,
					)

				if title == "" {

					title =
						strings.TrimSpace(
							seed.Name,
						)

				}

				posterPath :=
					strings.TrimSpace(
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

					results <- batchResult{
						Index: index,
						Valid: false,
					}

					continue

				}

				genre :=
					firstSeriesGenre(
						details.Genres,
					)

				if genre == "" {

					genre =
						seriesGenreFromIDs(
							seed.GenreIDs,
						)

				}

				if genre == "" {

					genre =
						"Series"

				}

				rating :=
					details.VoteAverage

				if rating <= 0 {

					rating =
						seed.VoteAverage

				}

				results <- batchResult{

					Index: index,

					Valid: true,

					Card: SeriesCard{

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
					},
				}

			}

		}()

	}

	/* =====================================================
	   SEND JOBS
	   ===================================================== */

	for index := range seeds {

		jobs <- index

	}

	close(jobs)

	waitGroup.Wait()

	close(results)

	/* =====================================================
	   PRESERVE TMDB ORDER

	   Workers finish in arbitrary order, so we put them
	   back into their original candidate order.
	   ===================================================== */

	ordered :=
		make([]batchResult, len(seeds))

	for result := range results {

		ordered[result.Index] =
			result

	}

	final :=
		make([]SeriesCard, 0, len(seeds))

	for _, result := range ordered {

		if !result.Valid {

			continue

		}

		final =
			append(
				final,
				result.Card,
			)

	}

	return final

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
