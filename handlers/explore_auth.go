package handlers

import "net/http"

// CurrentUserID is the single authentication integration point used by
// the Explore social/personal features.
//
// Set it from your existing MoviPilot auth/session middleware at startup,
// for example:
//
//	handlers.CurrentUserID = auth.CurrentUserID
//
// The Explore page itself remains publicly readable; write actions return
// HTTP 401 until this function is wired to the real authenticated user.
var CurrentUserID = func(r *http.Request) (int64, bool) {
	return 0, false
}
