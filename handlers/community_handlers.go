package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"MoviPilot/funcs/storage"
)

var communityPublicIDPattern = regexp.MustCompile(`(?i)^MP[a-f0-9]{20}$`)

// communityMemberDTO is deliberately allow-listed. It never contains email,
// internal numeric database IDs, password hashes, Google IDs, or auth details.
type communityMemberDTO struct {
	PublicID    string `json:"publicId"`
	Username    string `json:"username"`
	FullName    string `json:"fullName"`
	CreatedAt   string `json:"createdAt"`
	FriendCount int64  `json:"friendCount"`
	MarkedByMe  bool   `json:"markedByMe"`
	IsSelf      bool   `json:"isSelf"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
}

func toCommunityMemberDTO(member storage.CommunityMember) communityMemberDTO {
	return communityMemberDTO{
		PublicID:    member.PublicID,
		Username:    member.Username,
		FullName:    member.FullName,
		CreatedAt:   normalizeCommunityDate(member.CreatedAt),
		FriendCount: member.FriendCount,
		MarkedByMe:  member.MarkedByMe,
		IsSelf:      member.IsSelf,
		// The current users schema has no avatar column. The UI uses a polished
		// initials avatar with a deterministic gradient until photo support exists.
		AvatarURL: "",
	}
}

// CommunityPageHandler serves the HTML fragment fetched by the current
// dashboard loader at GET /community. CSS and JS are loaded by dashboard.html.
func CommunityPageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	page, err := os.ReadFile("templates/community.html")
	if err != nil {
		http.Error(w, "The Community page could not be loaded.", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(page)
}

// CommunityUsersHandler returns a limited list of public profiles.
// GET /api/community/users?mode=username&q=... searches usernames.
// GET /api/community/users?mode=id&q=MP... looks up an exact public ID.
func CommunityUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}

	mode := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mode")))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if mode != "username" && mode != "id" {
		writeCommunityError(w, "Choose username or MoviPilot ID search.", http.StatusBadRequest)
		return
	}
	if query == "" {
		writeCommunityError(w, "Enter a search value.", http.StatusBadRequest)
		return
	}

	if mode == "username" {
		if len([]rune(query)) < 2 || len([]rune(query)) > 64 {
			writeCommunityError(w, "Member searches must contain 2 to 64 characters.", http.StatusBadRequest)
			return
		}
	} else {
		query = strings.ToUpper(query)
		if !communityPublicIDPattern.MatchString(query) {
			writeCommunityError(w, "Enter the full MoviPilot ID.", http.StatusBadRequest)
			return
		}
	}

	members, err := storage.SearchCommunityMembers(viewerID, mode, query, 12)
	if err != nil {
		writeCommunityError(w, "We could not search the community right now.", http.StatusInternalServerError)
		return
	}

	responseMembers := make([]communityMemberDTO, 0, len(members))
	for _, member := range members {
		responseMembers = append(responseMembers, toCommunityMemberDTO(member))
	}

	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"users":   responseMembers,
	})
}

// CommunityUserProfileHandler returns the public data displayed by the profile
// modal. Email and all private authentication fields are intentionally omitted.
// GET /api/community/user?id=MP...
func CommunityUserProfileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}

	publicID := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("id")))
	if !communityPublicIDPattern.MatchString(publicID) {
		writeCommunityError(w, "Enter a valid MoviPilot ID.", http.StatusBadRequest)
		return
	}

	member, err := storage.GetCommunityMemberByPublicID(viewerID, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeCommunityError(w, "That MoviPilot member could not be found.", http.StatusNotFound)
			return
		}
		writeCommunityError(w, "We could not load this member profile.", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"user":    toCommunityMemberDTO(member),
	})
}

type communityFriendMarkRequest struct {
	TargetPublicID string `json:"targetPublicId"`
	Marked         *bool  `json:"marked"`
}

// CommunityFriendMarkHandler creates/removes the current user's friend mark.
// POST /api/community/friend with {"targetPublicId":"MP...","marked":true}.
// The desired state makes the operation idempotent rather than a blind toggle.
func CommunityFriendMarkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeCommunityError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !communityRequestIsSameOrigin(r) {
		writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}

	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input communityFriendMarkRequest
	if err := decoder.Decode(&input); err != nil {
		writeCommunityError(w, "Provide a valid friend-mark request.", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeCommunityError(w, "The request must contain one JSON object.", http.StatusBadRequest)
		return
	}

	publicID := strings.ToUpper(strings.TrimSpace(input.TargetPublicID))
	if !communityPublicIDPattern.MatchString(publicID) || input.Marked == nil {
		writeCommunityError(w, "A valid target ID and marked value are required.", http.StatusBadRequest)
		return
	}

	target, err := storage.GetCommunityMemberByPublicID(viewerID, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeCommunityError(w, "That MoviPilot member could not be found.", http.StatusNotFound)
			return
		}
		writeCommunityError(w, "We could not update this friend mark.", http.StatusInternalServerError)
		return
	}
	if target.ID == viewerID {
		writeCommunityError(w, "You cannot mark your own account as a friend.", http.StatusBadRequest)
		return
	}

	count, err := storage.SetCommunityFriendMark(viewerID, target.ID, *input.Marked)
	if err != nil {
		writeCommunityError(w, "We could not update this friend mark.", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":     true,
		"markedByMe":  *input.Marked,
		"friendCount": count,
	})
}

func communityCurrentUserID(r *http.Request) (int64, bool) {
	if r == nil {
		return 0, false
	}
	cookie, err := r.Cookie("movipilot_session")
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return 0, false
	}
	userID, err := storage.GetUserIDBySession(strings.TrimSpace(cookie.Value))
	if err != nil || userID <= 0 {
		return 0, false
	}
	return userID, true
}

func communityRequestIsSameOrigin(r *http.Request) bool {
	candidate := strings.TrimSpace(r.Header.Get("Origin"))
	if candidate == "" {
		candidate = strings.TrimSpace(r.Header.Get("Referer"))
	}
	if candidate == "" {
		return false
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Host == "" || r.Host == "" {
		return false
	}
	return strings.EqualFold(parsed.Host, r.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func normalizeCommunityDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	layouts := []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		var parsed time.Time
		var err error
		if strings.Contains(layout, "-07:00") || layout == time.RFC3339Nano {
			parsed, err = time.Parse(layout, value)
		} else {
			parsed, err = time.ParseInLocation(layout, value, time.UTC)
		}
		if err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func writeCommunityError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": false,
		"error":   message,
	})
}
