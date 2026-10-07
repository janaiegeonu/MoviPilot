package handlers

import (
	"net/http"
	"strings"

	"MoviPilot/funcs/storage"
)

// CurrentUserID is the authentication bridge used by the Explore subsystem.
//
// MoviPilot already stores the authenticated user's session ID in the
// "movipilot_session" cookie. This helper reads that cookie and resolves it
// through the existing storage.GetUserIDBySession function.
//
// Both normal email/password login and Google OAuth must create the same
// MoviPilot session before redirecting the user to /dashboard. That way,
// Explore does not need a second authentication system.
//
// The returned boolean is true only when a valid, non-expired session belongs
// to a real user ID.
var CurrentUserID = func(r *http.Request) (int64, bool) {
	if r == nil {
		return 0, false
	}

	cookie, err := r.Cookie("movipilot_session")
	if err != nil {
		return 0, false
	}

	sessionID := strings.TrimSpace(cookie.Value)
	if sessionID == "" {
		return 0, false
	}

	userID, err := storage.GetUserIDBySession(sessionID)
	if err != nil || userID <= 0 {
		return 0, false
	}

	return userID, true
}
