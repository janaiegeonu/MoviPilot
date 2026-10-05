package handlers

import (
	"MoviPilot/funcs/storage"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gopkg.in/mail.v2"
)

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
