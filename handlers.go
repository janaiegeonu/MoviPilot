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

	if err == nil {

		// Existing Google account.
		sessionID, err := storage.CreateSession(user.ID)
		if err != nil {
			http.Error(
				w,
				"Unable to create login session",
				http.StatusInternalServerError,
			)
			return
		}

		setLoginCookie(w, r, sessionID)

		http.Redirect(
			w,
			r,
			"/homepage",
			http.StatusSeeOther,
		)

		return
	}

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

	/*
		The Google ID was not found.

		Now check whether the email is already
		connected to another MoviPilot account.
	*/
	existingUser, err := storage.GetUserByEmail(
		googleUser.Email,
	)

	if err == nil {

		/*
			The email already belongs to another account.

			Do NOT silently merge accounts.
			That would be a separate account-linking decision.
		*/
		if existingUser.AuthProvider == "local" {

			http.Redirect(
				w,
				r,
				"/login?google=existing",
				http.StatusSeeOther,
			)

			return
		}

		// Another Google record should not normally happen,
		// but do not create a duplicate account.
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

	/*
		At this point:

		Google ID does not exist.
		Email does not exist.

		So this is a brand-new MoviPilot account.
	*/
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

	// Retrieve the newly created user so we get its database ID.
	user, err = storage.GetUserByGoogleID(
		googleUser.Sub,
	)

	if err != nil {

		http.Error(
			w,
			"Account was created but could not be loaded",
			http.StatusInternalServerError,
		)
		return
	}

	/*
		Create normal MoviPilot session.
	*/
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

	/*
		Google signup is successful.
	*/
	http.Redirect(
		w,
		r,
		"/homepage",
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
