package handlers

import (
	"MoviPilot/funcs/form"
	"MoviPilot/funcs/storage"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

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
