package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"MoviPilot/funcs/storage"
)

// ProfileMarksHandler powers the Marked me / I've marked section in the
// signed-in user's profile card.
//
// GET /api/profile/marks?list=summary
// GET /api/profile/marks?list=marked-me
// GET /api/profile/marks?list=marked-by-me
//
// Only public profile fields are returned for listed members. Email, internal
// database IDs and authentication fields are never included.
func ProfileMarksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	listMode := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("list")))
	if listMode == "" {
		listMode = "summary"
	}

	switch listMode {
	case "summary":
		counts, err := storage.GetCommunityProfileMarkCounts(userID)
		if err != nil {
			writeCommunityError(w, "We could not load your mark counts right now.", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"counts":  counts,
		})

	case "marked-me", "marked-by-me":
		members, total, err := storage.ListCommunityProfileMarks(userID, listMode, 100)
		if err != nil {
			writeCommunityError(w, "We could not load this member list right now.", http.StatusInternalServerError)
			return
		}

		users := make([]communityMemberDTO, 0, len(members))
		for _, member := range members {
			users = append(users, toCommunityMemberDTO(member))
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"list":    listMode,
			"count":   total,
			"users":   users,
		})

	default:
		writeCommunityError(w, "Choose summary, marked-me, or marked-by-me.", http.StatusBadRequest)
	}
}
