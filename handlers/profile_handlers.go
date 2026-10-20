package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"MoviPilot/funcs/storage"
)

// profileCardResponse deliberately excludes internal database IDs, password
// hashes, Google IDs, and all other private authentication fields.
type profileCardResponse struct {
	Success bool               `json:"success"`
	User    profileCardUserDTO `json:"user"`
}

type profileCardUserDTO struct {
	PublicID  string `json:"publicId"`
	FullName  string `json:"fullName"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
}

// ProfileCardHandler returns the signed-in account's profile details from SQLite.
// Register this at GET /api/profile.
func ProfileCardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeProfileJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Cache-Control", "no-store, private")
	userID, ok := profileUserIDFromRequest(r)
	if !ok {
		writeProfileJSONError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}

	user, err := storage.GetUserByID(userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeProfileJSONError(w, "This account could not be found. Please sign in again.", http.StatusUnauthorized)
			return
		}
		writeProfileJSONError(w, "We could not load the profile right now.", http.StatusInternalServerError)
		return
	}

	createdAt := ""
	if !user.CreatedAt.IsZero() {
		createdAt = user.CreatedAt.Format(time.RFC3339)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(profileCardResponse{
		Success: true,
		User: profileCardUserDTO{
			PublicID:  user.PublicID,
			FullName:  user.FullName,
			Email:     user.Email,
			CreatedAt: createdAt,
		},
	})
}

// ProfileLogoutHandler revokes the matching database session, expires the
// browser cookie, and returns the user to the public entry page (/).
// Register this at POST /logout.
func ProfileLogoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	secureCookie := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	for _, cookie := range r.Cookies() {
		if strings.TrimSpace(cookie.Value) == "" {
			continue
		}

		// The project session-cookie name wasn't included with the supplied
		// storage files. Validate cookie values against the sessions table so
		// this works with the real cookie name without exposing the token.
		userID, err := storage.GetUserIDBySession(cookie.Value)
		if err == nil && userID > 0 {
			_ = storage.DeleteSession(cookie.Value)
			writeExpiredProfileCookie(w, cookie.Name, secureCookie)
			continue
		}

		// Also clear an expired cookie with a conventional session-like name.
		if strings.Contains(strings.ToLower(cookie.Name), "session") {
			writeExpiredProfileCookie(w, cookie.Name, secureCookie)
		}
	}

	

	// The modal submits a regular POST form, so this redirect navigates the
	// complete dashboard back to the public homepage.
	http.Redirect(w, r, "/homepage", http.StatusSeeOther)
}

func profileUserIDFromRequest(r *http.Request) (int64, bool) {
	// Check cookie values against the session store rather than hard-coding a
	// cookie key that was not present in the supplied login/session code.
	// The request cookie count is naturally small; cap it defensively.
	cookies := r.Cookies()
	if len(cookies) > 64 {
		cookies = cookies[:64]
	}

	for _, cookie := range cookies {
		if strings.TrimSpace(cookie.Value) == "" {
			continue
		}
		userID, err := storage.GetUserIDBySession(cookie.Value)
		if err == nil && userID > 0 {
			return userID, true
		}
	}
	return 0, false
}

func writeExpiredProfileCookie(w http.ResponseWriter, name string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func writeProfileJSONError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, private")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
	})
}
