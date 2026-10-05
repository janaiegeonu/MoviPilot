package handlers

import (
	"MoviPilot/funcs/storage"
	"database/sql"
	"errors"
	"net/http"

	"golang.org/x/crypto/bcrypt"
)

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

	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}
