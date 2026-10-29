package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"MoviPilot/funcs/storage"
)

type chatPresenceRequest struct {
	ClientID string `json:"clientId"`
}

// CommunityChatPresenceHandler supports:
//
//	GET    /api/community/chat/presence                  roster + authoritative count
//	GET    /api/community/chat/presence?publicId=MP...   profile presence
//	POST   /api/community/chat/presence                  heartbeat + authoritative count
//	DELETE /api/community/chat/presence                  explicit tab leave
//
// The roster GET intentionally records a heartbeat before counting. This makes a
// just-opened chat count its viewer immediately instead of waiting for the first
// JavaScript interval. A successful heartbeat means this authenticated viewer must
// be included in the returned online count and roster.
func CommunityChatPresenceHandler(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Vary", "Cookie")

	switch r.Method {
	case http.MethodGet:
		// Profile presence must not create a heartbeat for someone else. Only the
		// authenticated viewer's roster request below is allowed to touch presence.
		if publicID := strings.TrimSpace(r.URL.Query().Get("publicId")); publicID != "" {
			status, err := storage.GetCommunityChatMemberPresenceStatus(publicID)
			if err != nil {
				writeCommunityError(w, "Could not load this member's chat presence.", http.StatusNotFound)
				return
			}
			writeCommunityJSON(w, http.StatusOK, map[string]any{
				"success": true, "memberStatus": status,
				"serverTime": time.Now().UTC().Format(time.RFC3339Nano),
			})
			return
		}

		clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
		if clientID == "" {
			// Compatibility with a stale JS bundle that does not provide clientId.
			// This fallback is a valid 32-character lower-case hexadecimal value.
			clientID = fmt.Sprintf("%032x", uint64(viewerID))
		}
		if err := storage.TouchCommunityChatPresence(viewerID, clientID); err != nil {
			fmt.Printf("[community chat] roster self-presence touch failed user=%d client=%q: %v\n", viewerID, clientID, err)
			writeCommunityError(w, "Could not register your online status. Refresh the chat and try again.", http.StatusInternalServerError)
			return
		}

		onlineCount, err := storage.CountOnlineCommunityChatMembers()
		if err != nil {
			fmt.Printf("[community chat] online count failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not count online members.", http.StatusInternalServerError)
			return
		}
		// This request successfully wrote a fresh heartbeat for the authenticated
		// viewer. Therefore a count below one indicates a database/query race, not
		// that nobody is online. Keep the guaranteed active viewer in the count.
		if onlineCount < 1 {
			onlineCount = 1
		}

		members, err := storage.ListCommunityChatPresence(100)
		if err != nil {
			fmt.Printf("[community chat] roster query failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not load chat presence. Ensure storage.EnsureCommunityChatSchema() runs before the chat routes are served.", http.StatusInternalServerError)
			return
		}
		self, err := storage.GetCommunityChatPresenceForUserID(viewerID)
		if err != nil {
			fmt.Printf("[community chat] own roster identity failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not load your online profile.", http.StatusInternalServerError)
			return
		}
		// The heartbeat above makes this viewer online for this response. Also add
		// them defensively if a concurrent roster update/pagination omitted the row.
		self.IsOnline = true
		foundSelf := false
		for i := range members {
			if strings.EqualFold(members[i].PublicID, self.PublicID) {
				members[i].IsOnline = true
				if members[i].LastSeenAt == "" {
					members[i].LastSeenAt = self.LastSeenAt
				}
				foundSelf = true
				break
			}
		}
		if !foundSelf {
			members = append([]storage.CommunityChatPresence{self}, members...)
		}

		online := make([]storage.CommunityChatPresence, 0, len(members))
		recent := make([]storage.CommunityChatPresence, 0, len(members))
		for _, member := range members {
			if member.IsOnline {
				online = append(online, member)
			}
			recent = append(recent, member)
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{
			"success":          true,
			"onlineCount":      onlineCount,
			"selfOnline":       true,
			"clientId":         clientID,
			"onlineTTLSeconds": 90,
			"serverTime":       time.Now().UTC().Format(time.RFC3339Nano),
			"online":           online,
			"recent":           recent,
		})

	case http.MethodPost:
		if !communityRequestIsSameOrigin(r) {
			writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		var input chatPresenceRequest
		if err := decodeChatJSON(w, r, &input, 2048); err != nil {
			writeCommunityError(w, "Invalid presence heartbeat.", http.StatusBadRequest)
			return
		}
		input.ClientID = strings.TrimSpace(input.ClientID)
		if err := storage.TouchCommunityChatPresence(viewerID, input.ClientID); err != nil {
			fmt.Printf("[community chat] heartbeat failed user=%d client=%q: %v\n", viewerID, input.ClientID, err)
			writeCommunityError(w, "Could not update chat presence.", http.StatusBadRequest)
			return
		}
		onlineCount, err := storage.CountOnlineCommunityChatMembers()
		if err != nil {
			fmt.Printf("[community chat] post-heartbeat count failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not count online members.", http.StatusInternalServerError)
			return
		}
		if onlineCount < 1 {
			onlineCount = 1
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{
			"success":          true,
			"onlineCount":      onlineCount,
			"selfOnline":       true,
			"clientId":         input.ClientID,
			"onlineTTLSeconds": 90,
			"serverTime":       time.Now().UTC().Format(time.RFC3339Nano),
		})

	case http.MethodDelete:
		if !communityRequestIsSameOrigin(r) {
			writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		var input chatPresenceRequest
		if err := decodeChatJSON(w, r, &input, 2048); err != nil {
			writeCommunityError(w, "Invalid presence leave request.", http.StatusBadRequest)
			return
		}
		input.ClientID = strings.TrimSpace(input.ClientID)
		if err := storage.LeaveCommunityChatPresence(viewerID, input.ClientID); err != nil {
			writeCommunityError(w, "Could not update chat presence.", http.StatusBadRequest)
			return
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true})

	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
	}
}

// CommunityChatMentionMembersHandler powers @mention autocomplete and exact
// username-to-public-profile lookup. It never returns private account fields.
func CommunityChatMentionMembersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	if username := strings.TrimSpace(r.URL.Query().Get("username")); username != "" {
		member, err := storage.GetCommunityChatMentionMemberByUsername(username)
		if err != nil {
			writeCommunityError(w, "That username is not available.", http.StatusNotFound)
			return
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "member": member})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	members, err := storage.SearchCommunityChatMentionMembers(viewerID, query, 8)
	if err != nil {
		fmt.Printf("[community chat] member search failed viewer=%d: %v\n", viewerID, err)
		writeCommunityError(w, "Could not search chat members.", http.StatusInternalServerError)
		return
	}
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "members": members})
}

// CommunityChatMentionsHandler lists unread mention notifications (GET) and marks
// one as read (POST). New and legacy routes are supported below.
func CommunityChatMentionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		communityChatMarkMentionRead(w, r)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, POST")
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	mentions, count, err := storage.ListUnreadCommunityChatMentions(viewerID, 30)
	if err != nil {
		fmt.Printf("[community chat] unread mention query failed viewer=%d: %v\n", viewerID, err)
		writeCommunityError(w, "Could not load mention notifications.", http.StatusInternalServerError)
		return
	}
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "unreadCount": count, "mentions": mentions})
}

// CommunityChatMentionReadHandler is a compatibility alias for older cached JS
// bundles that POST to /api/community/chat/mentions/read.
func CommunityChatMentionReadHandler(w http.ResponseWriter, r *http.Request) {
	communityChatMarkMentionRead(w, r)
}

func communityChatMarkMentionRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	if !communityRequestIsSameOrigin(r) {
		writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}
	var input struct {
		ID int64 `json:"id"`
	}
	if err := decodeChatJSON(w, r, &input, 2048); err != nil || input.ID <= 0 {
		writeCommunityError(w, "A valid mention ID is required.", http.StatusBadRequest)
		return
	}
	if err := storage.MarkCommunityChatMentionRead(viewerID, input.ID); err != nil {
		fmt.Printf("[community chat] mark mention read failed viewer=%d mention=%d: %v\n", viewerID, input.ID, err)
		writeCommunityError(w, "Could not update mention notification.", http.StatusInternalServerError)
		return
	}
	_, count, err := storage.ListUnreadCommunityChatMentions(viewerID, 1)
	if err != nil {
		writeCommunityError(w, "Could not refresh mention count.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "unreadCount": count})
}

// CommunityChatReactionUsersHandler returns the identities behind reactions on a
// message. Route it at GET /api/community/chat/reactions to match the chat JS.
func CommunityChatReactionUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	messageID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("messageId")), 10, 64)
	if err != nil || messageID <= 0 {
		writeCommunityError(w, "A valid message ID is required.", http.StatusBadRequest)
		return
	}
	members, err := storage.ListCommunityChatReactionMembers(messageID, 100)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "message not found") {
			writeCommunityError(w, "That message is no longer available.", http.StatusNotFound)
			return
		}
		fmt.Printf("[community chat] reaction roster failed viewer=%d message=%d: %v\n", viewerID, messageID, err)
		writeCommunityError(w, "Could not load the people who reacted to that message.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "messageId": messageID, "reactors": members})
}