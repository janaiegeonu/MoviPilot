package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

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
// CommunityChatPresenceHandler supports heartbeat (POST), current/recent list (GET),
// and explicit leave (DELETE). Presence rows expire from the online count after 90s.
// The response adds self/selfOnline/selfPublicId fields without removing the existing
// onlineCount, online, recent, or memberStatus fields consumed by the chat UI.
func CommunityChatPresenceHandler(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")

	switch r.Method {
	case http.MethodGet:
		// The public profile modal requests only one member's presence.
		if publicID := strings.TrimSpace(r.URL.Query().Get("publicId")); publicID != "" {
			status, err := storage.GetCommunityChatMemberPresenceStatus(publicID)
			if err != nil {
				writeCommunityError(w, "Could not load this member's chat presence.", http.StatusNotFound)
				return
			}
			writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "memberStatus": status})
			return
		}

		clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
		if clientID == "" {
			// Compatibility for older cached bundles. New clients always provide a
			// random per-tab client ID; this fallback is a valid, account-scoped ID.
			clientID = fmt.Sprintf("%032x", uint64(viewerID))
		}
		// Make the authenticated viewer active before calculating the online count.
		// This prevents the first/single member from seeing a false zero.
		if err := storage.TouchCommunityChatPresence(viewerID, clientID); err != nil {
			fmt.Printf("[community chat] roster self-presence touch failed user=%d client=%q: %v\n", viewerID, clientID, err)
			writeCommunityError(w, "Could not register your online status. Refresh the chat and try again.", http.StatusInternalServerError)
			return
		}
		self, err := storage.GetCommunityChatPresenceForUserID(viewerID)
		if err != nil {
			fmt.Printf("[community chat] load self-presence failed user=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not load your online status.", http.StatusInternalServerError)
			return
		}
		onlineCount, err := storage.CountOnlineCommunityChatMembers()
		if err != nil {
			fmt.Printf("[community chat] online count failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not count online members.", http.StatusInternalServerError)
			return
		}
		members, err := storage.ListCommunityChatPresence(100)
		if err != nil {
			fmt.Printf("[community chat] list presence failed viewer=%d: %v\n", viewerID, err)
			writeCommunityError(w, "Could not load chat presence. Ensure EnsureCommunityChatSchema() runs before the chat routes are served.", http.StatusInternalServerError)
			return
		}

		// The full roster normally already contains self. Include the authenticated
		// user explicitly if a bounded roster or concurrent update omitted them.
		selfListed := false
		for _, member := range members {
			if strings.EqualFold(member.PublicID, self.PublicID) && self.PublicID != "" {
				selfListed = true
				break
			}
		}
		if self.IsOnline && !selfListed {
			members = append(members, self)
		}

		online := make([]storage.CommunityChatPresence, 0, len(members))
		recent := make([]storage.CommunityChatPresence, 0, len(members))
		for _, member := range members {
			if member.IsOnline {
				online = append(online, member)
			}
			recent = append(recent, member)
		}
		// If the same successful touch is confirmed online, the count cannot
		// logically be zero. Preserve the server count otherwise.
		if self.IsOnline && onlineCount < 1 {
			onlineCount = 1
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{
			"success":      true,
			"onlineCount":  onlineCount,
			"online":       online,
			"recent":       recent,
			"self":         self,
			"selfOnline":   self.IsOnline,
			"selfPublicId": self.PublicID,
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
		self, err := storage.GetCommunityChatPresenceForUserID(viewerID)
		if err != nil {
			writeCommunityError(w, "Could not verify your online status.", http.StatusInternalServerError)
			return
		}
		onlineCount, err := storage.CountOnlineCommunityChatMembers()
		if err != nil {
			writeCommunityError(w, "Could not count online members.", http.StatusInternalServerError)
			return
		}
		if self.IsOnline && onlineCount < 1 {
			onlineCount = 1
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{
			"success":      true,
			"onlineCount":  onlineCount,
			"self":         self,
			"selfOnline":   self.IsOnline,
			"selfPublicId": self.PublicID,
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
