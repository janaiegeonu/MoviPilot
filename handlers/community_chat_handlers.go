package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"MoviPilot/funcs/storage"
)

const (
	chatMessageMaxRunes = 3000
	chatUploadMaxBytes  = 24 << 20
	chatImageMaxBytes   = 18 << 20
	chatAudioMaxBytes   = 12 << 20
)

var chatMediaFilenamePattern = regexp.MustCompile(`^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|weba|ogg|m4a|mp3|wav)$`)

var allowedChatReactions = map[string]struct{}{
	"like": {}, "love": {}, "dislike": {}, "fire": {}, "laugh": {}, "cry": {}, "wow": {}, "angry": {}, "awful": {},
}

type chatSenderDTO struct {
	PublicID string `json:"publicId"`
	Username string `json:"username"`
	FullName string `json:"fullName"`
}

type chatReplyDTO struct {
	ID      int64         `json:"id"`
	Sender  chatSenderDTO `json:"sender"`
	Body    string        `json:"body"`
	Kind    string        `json:"kind"`
	Deleted bool          `json:"deleted"`
}

type chatMovieDTO struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	PosterURL   string `json:"posterUrl,omitempty"`
	Overview    string `json:"overview,omitempty"`
	ReleaseDate string `json:"releaseDate,omitempty"`
	ExploreURL  string `json:"exploreUrl"`
}

type chatMessageDTO struct {
	ID             int64            `json:"id"`
	Sender         chatSenderDTO    `json:"sender"`
	Body           string           `json:"body"`
	Kind           string           `json:"kind"`
	AttachmentURL  string           `json:"attachmentUrl,omitempty"`
	AttachmentMIME string           `json:"attachmentMime,omitempty"`
	AttachmentName string           `json:"attachmentName,omitempty"`
	AttachmentSize int64            `json:"attachmentSize,omitempty"`
	Movie          *chatMovieDTO    `json:"movie,omitempty"`
	ReplyTo        *chatReplyDTO    `json:"replyTo,omitempty"`
	CreatedAt      string           `json:"createdAt"`
	EditedAt       string           `json:"editedAt,omitempty"`
	Deleted        bool             `json:"deleted"`
	IsMine         bool             `json:"isMine"`
	ReactionCounts map[string]int64 `json:"reactionCounts"`
	MyReaction     string           `json:"myReaction,omitempty"`
}

func toCommunityChatDTO(message storage.CommunityChatMessage, viewerID int64) chatMessageDTO {
	dto := chatMessageDTO{
		ID: message.ID,
		Sender: chatSenderDTO{
			PublicID: message.SenderPublicID,
			Username: message.SenderUsername,
			FullName: message.SenderFullName,
		},
		Body:           message.Body,
		Kind:           message.Kind,
		AttachmentURL:  message.AttachmentURL,
		AttachmentMIME: message.AttachmentMIME,
		AttachmentName: message.AttachmentName,
		AttachmentSize: message.AttachmentSize,
		CreatedAt:      normalizeCommunityDate(message.CreatedAt),
		EditedAt:       normalizeCommunityDate(message.EditedAt),
		Deleted:        message.DeletedAt != "" || message.Kind == "deleted",
		IsMine:         message.SenderID == viewerID,
		ReactionCounts: message.ReactionCounts,
		MyReaction:     message.MyReaction,
	}
	if dto.ReactionCounts == nil {
		dto.ReactionCounts = map[string]int64{}
	}
	if dto.Deleted {
		dto.Body = ""
		dto.AttachmentURL = ""
		dto.AttachmentMIME = ""
		dto.AttachmentName = ""
		dto.Movie = nil
	}
	if message.MovieID > 0 && !dto.Deleted {
		dto.Movie = &chatMovieDTO{
			ID: message.MovieID, Title: message.MovieTitle, PosterURL: message.MoviePosterURL,
			Overview: message.MovieOverview, ReleaseDate: message.MovieReleaseDate,
			ExploreURL: fmt.Sprintf("/explore?type=movie&id=%d", message.MovieID),
		}
	}
	if message.ReplyTo != nil {
		dto.ReplyTo = &chatReplyDTO{
			ID:     message.ReplyTo.ID,
			Sender: chatSenderDTO{PublicID: message.ReplyTo.SenderPublicID, Username: message.ReplyTo.SenderUsername, FullName: message.ReplyTo.SenderFullName},
			Body:   message.ReplyTo.Body, Kind: message.ReplyTo.Kind, Deleted: message.ReplyTo.Deleted,
		}
	}
	return dto
}

// CommunityChatFragmentHandler returns the separate chatroom HTML fragment.
// GET /community/chat — the Community JS injects it into its existing page mount.
func CommunityChatFragmentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := communityCurrentUserID(r); !ok {
		http.Error(w, "Please sign in to enter the community chat.", http.StatusUnauthorized)
		return
	}
	fragment, err := os.ReadFile("templates/community_chat.html")
	if err != nil {
		http.Error(w, "The community chatroom could not be loaded.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, private")
	_, _ = w.Write(fragment)
}

type chatMessageRequest struct {
	Body             string `json:"body"`
	Kind             string `json:"kind"`
	ReplyToID        int64  `json:"replyToId"`
	AttachmentURL    string `json:"attachmentUrl"`
	AttachmentMIME   string `json:"attachmentMime"`
	AttachmentName   string `json:"attachmentName"`
	AttachmentSize   int64  `json:"attachmentSize"`
	MovieID          int64  `json:"movieId"`
	MovieTitle       string `json:"movieTitle"`
	MoviePosterURL   string `json:"moviePosterUrl"`
	MovieOverview    string `json:"movieOverview"`
	MovieReleaseDate string `json:"movieReleaseDate"`
}

// CommunityChatMessagesHandler reads message history and handles send/edit/delete.
// GET/POST/PATCH/DELETE /api/community/chat/messages
func CommunityChatMessagesHandler(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")

	switch r.Method {
	case http.MethodGet:
		limit := 60
		if raw := r.URL.Query().Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil {
				writeCommunityError(w, "Invalid message limit.", http.StatusBadRequest)
				return
			}
			limit = parsed
		}
		afterID, err := parseOptionalChatID(r.URL.Query().Get("after"))
		if err != nil {
			writeCommunityError(w, "Invalid message cursor.", http.StatusBadRequest)
			return
		}
		beforeID, err := parseOptionalChatID(r.URL.Query().Get("before"))
		if err != nil {
			writeCommunityError(w, "Invalid message cursor.", http.StatusBadRequest)
			return
		}
		if afterID > 0 && beforeID > 0 {
			writeCommunityError(w, "Use either after or before, not both.", http.StatusBadRequest)
			return
		}
		messages, err := storage.ListCommunityChatMessages(viewerID, afterID, beforeID, limit)
		if err != nil {
			writeCommunityError(w, "We could not load chat messages.", http.StatusInternalServerError)
			return
		}
		items := make([]chatMessageDTO, 0, len(messages))
		for _, message := range messages {
			items = append(items, toCommunityChatDTO(message, viewerID))
		}
		writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "messages": items})

	case http.MethodPost:
		if !communityRequestIsSameOrigin(r) {
			writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		var input chatMessageRequest
		if err := decodeChatJSON(w, r, &input, 16<<10); err != nil {
			writeCommunityError(w, "Provide a valid chat message.", http.StatusBadRequest)
			return
		}
		messageInput, err := validateChatMessageRequest(input)
		if err != nil {
			writeCommunityError(w, err.Error(), http.StatusBadRequest)
			return
		}
		message, err := storage.CreateCommunityChatMessage(viewerID, messageInput)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeCommunityError(w, "The reply target no longer exists.", http.StatusBadRequest)
				return
			}
			writeCommunityError(w, "We could not send that message.", http.StatusInternalServerError)
			return
		}
		broadcastCommunityChatEvent("new", message.ID)
		writeCommunityJSON(w, http.StatusCreated, map[string]any{"success": true, "message": toCommunityChatDTO(message, viewerID)})

	case http.MethodPatch:
		if !communityRequestIsSameOrigin(r) {
			writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		id, err := parseOptionalChatID(r.URL.Query().Get("id"))
		if err != nil || id <= 0 {
			writeCommunityError(w, "A valid message ID is required.", http.StatusBadRequest)
			return
		}
		var input struct {
			Body string `json:"body"`
		}
		if err := decodeChatJSON(w, r, &input, 8192); err != nil {
			writeCommunityError(w, "Provide a valid edit request.", http.StatusBadRequest)
			return
		}
		body := strings.TrimSpace(input.Body)
		if body == "" || len([]rune(body)) > chatMessageMaxRunes {
			writeCommunityError(w, "Edited messages must contain 1 to 3000 characters.", http.StatusBadRequest)
			return
		}
		message, err := storage.EditCommunityChatMessage(viewerID, id, body)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeCommunityError(w, "Only your own active text messages can be edited.", http.StatusForbidden)
				return
			}
			writeCommunityError(w, "We could not edit that message.", http.StatusInternalServerError)
			return
		}
		broadcastCommunityChatEvent("refresh", message.ID)
		writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "message": toCommunityChatDTO(message, viewerID)})

	case http.MethodDelete:
		if !communityRequestIsSameOrigin(r) {
			writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		id, err := parseOptionalChatID(r.URL.Query().Get("id"))
		if err != nil || id <= 0 {
			writeCommunityError(w, "A valid message ID is required.", http.StatusBadRequest)
			return
		}
		if err := storage.DeleteCommunityChatMessage(viewerID, id); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeCommunityError(w, "Only your own active message can be deleted.", http.StatusForbidden)
				return
			}
			writeCommunityError(w, "We could not delete that message.", http.StatusInternalServerError)
			return
		}
		broadcastCommunityChatEvent("refresh", id)
		writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "deleted": true, "id": id})

	default:
		w.Header().Set("Allow", "GET, POST, PATCH, DELETE")
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
	}
}

func validateChatMessageRequest(input chatMessageRequest) (storage.CommunityChatMessageInput, error) {
	body := strings.TrimSpace(input.Body)
	if len([]rune(body)) > chatMessageMaxRunes {
		return storage.CommunityChatMessageInput{}, fmt.Errorf("Messages must be 3000 characters or fewer.")
	}
	kind := strings.ToLower(strings.TrimSpace(input.Kind))
	if kind == "" {
		kind = "text"
	}
	out := storage.CommunityChatMessageInput{Body: body, Kind: kind, ReplyToID: input.ReplyToID}
	if input.ReplyToID < 0 {
		return out, fmt.Errorf("Invalid reply target.")
	}
	switch kind {
	case "text":
		if body == "" {
			return out, fmt.Errorf("Write a message before sending.")
		}
	case "image", "video", "voice":
		if !validCommunityAttachmentURL(input.AttachmentURL) {
			return out, fmt.Errorf("Upload that attachment again before sending.")
		}
		if input.AttachmentSize < 0 || input.AttachmentSize > chatUploadMaxBytes {
			return out, fmt.Errorf("That attachment is too large.")
		}
		mimeType, _, err := mime.ParseMediaType(input.AttachmentMIME)
		if err != nil {
			return out, fmt.Errorf("That attachment format is not supported.")
		}
		switch kind {
		case "image":
			if !strings.HasPrefix(mimeType, "image/") || !map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true}[mimeType] {
				return out, fmt.Errorf("Choose a JPG, PNG, GIF or WebP image.")
			}
		case "video":
			if mimeType != "video/mp4" && mimeType != "video/webm" {
				return out, fmt.Errorf("Choose an MP4 or WebM video.")
			}
		case "voice":
			if !strings.HasPrefix(mimeType, "audio/") && mimeType != "video/webm" {
				return out, fmt.Errorf("That voice-note format is not supported.")
			}
		}
		out.AttachmentURL, out.AttachmentMIME = input.AttachmentURL, mimeType
		out.AttachmentName = safeChatFilename(input.AttachmentName)
		out.AttachmentSize = input.AttachmentSize
	case "movie":
		if input.MovieID <= 0 || strings.TrimSpace(input.MovieTitle) == "" || len([]rune(input.MovieTitle)) > 180 {
			return out, fmt.Errorf("Choose a valid movie card before sending.")
		}
		out.MovieID = input.MovieID
		out.MovieTitle = strings.TrimSpace(input.MovieTitle)
		out.MovieOverview = limitChatText(input.MovieOverview, 600)
		out.MovieReleaseDate = limitChatText(input.MovieReleaseDate, 20)
		poster := strings.TrimSpace(input.MoviePosterURL)
		if poster != "" && !strings.HasPrefix(poster, "https://image.tmdb.org/t/p/") {
			return out, fmt.Errorf("The movie poster URL is not allowed.")
		}
		out.MoviePosterURL = poster
	default:
		return out, fmt.Errorf("Unsupported chat message type.")
	}
	return out, nil
}

func validCommunityAttachmentURL(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "/community-media/") {
		return false
	}
	name := strings.TrimPrefix(value, "/community-media/")
	return filepath.Base(name) == name && chatMediaFilenamePattern.MatchString(name)
}

func safeChatFilename(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	if value == "." || value == string(filepath.Separator) {
		return "attachment"
	}
	if len(value) > 100 {
		value = value[len(value)-100:]
	}
	return value
}

func limitChatText(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > max {
		return string(runes[:max])
	}
	return string(runes)
}

func parseOptionalChatID(value string) (int64, error) {
	if strings.TrimSpace(value) == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 0 {
		return 0, fmt.Errorf("invalid ID")
	}
	return id, nil
}

func decodeChatJSON(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("extra JSON values")
	}
	return nil
}

func writeCommunityJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, private")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type communityChatReactionRequest struct {
	MessageID int64  `json:"messageId"`
	Reaction  string `json:"reaction"`
}

// CommunityChatReactionHandler toggles one of the nine supported reactions.
func CommunityChatReactionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
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
	var input communityChatReactionRequest
	if err := decodeChatJSON(w, r, &input, 4096); err != nil {
		writeCommunityError(w, "Provide a valid reaction.", http.StatusBadRequest)
		return
	}
	input.Reaction = strings.ToLower(strings.TrimSpace(input.Reaction))
	if input.MessageID <= 0 {
		writeCommunityError(w, "A valid message ID is required.", http.StatusBadRequest)
		return
	}
	if _, valid := allowedChatReactions[input.Reaction]; !valid {
		writeCommunityError(w, "That reaction is not supported.", http.StatusBadRequest)
		return
	}
	message, err := storage.SetCommunityChatReaction(viewerID, input.MessageID, input.Reaction)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeCommunityError(w, "That message is no longer available.", http.StatusNotFound)
			return
		}
		writeCommunityError(w, "We could not save your reaction.", http.StatusInternalServerError)
		return
	}
	broadcastCommunityChatEvent("refresh", message.ID)
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "message": toCommunityChatDTO(message, viewerID)})
}

// CommunityChatUploadHandler stores bounded, allow-listed attachments under random server-side names.
// The upload filename provided by a browser is never used as the physical filename.
func CommunityChatUploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	if !communityRequestIsSameOrigin(r) {
		writeCommunityError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}
	if _, ok := communityCurrentUserID(r); !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, chatUploadMaxBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeCommunityError(w, "The upload is too large or malformed.", http.StatusRequestEntityTooLarge)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeCommunityError(w, "Choose a file to upload.", http.StatusBadRequest)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, chatUploadMaxBytes+1))
	if err != nil {
		writeCommunityError(w, "We could not read that file.", http.StatusBadRequest)
		return
	}
	if len(data) == 0 || int64(len(data)) > chatUploadMaxBytes {
		writeCommunityError(w, "That file is empty or larger than 24 MB.", http.StatusRequestEntityTooLarge)
		return
	}
	declared, _, _ := mime.ParseMediaType(header.Header.Get("Content-Type"))
	detected, _, _ := mime.ParseMediaType(http.DetectContentType(data[:min(512, len(data))]))
	mimeType, ext, err := validateUploadedChatMedia(declared, detected, data)
	if err != nil {
		writeCommunityError(w, err.Error(), http.StatusUnsupportedMediaType)
		return
	}
	if strings.HasPrefix(mimeType, "audio/") && int64(len(data)) > chatAudioMaxBytes {
		writeCommunityError(w, "Voice notes must be 12 MB or smaller.", http.StatusRequestEntityTooLarge)
		return
	}
	if strings.HasPrefix(mimeType, "image/") && int64(len(data)) > chatImageMaxBytes {
		writeCommunityError(w, "Images must be 18 MB or smaller.", http.StatusRequestEntityTooLarge)
		return
	}
	var randomBytes [16]byte
	if _, err := rand.Read(randomBytes[:]); err != nil {
		writeCommunityError(w, "We could not prepare that upload.", http.StatusInternalServerError)
		return
	}
	name := hex.EncodeToString(randomBytes[:]) + ext
	root := strings.TrimSpace(os.Getenv("MOVIPILOT_CHAT_MEDIA_DIR"))
	if root == "" {
		root = "community-chat-media"
	}
	if err := os.MkdirAll(root, 0750); err != nil {
		writeCommunityError(w, "Chat media storage is unavailable.", http.StatusInternalServerError)
		return
	}
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, data, 0640); err != nil {
		writeCommunityError(w, "We could not save that upload.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	writeCommunityJSON(w, http.StatusCreated, map[string]any{"success": true, "url": "/community-media/" + name, "mimeType": mimeType, "fileName": safeChatFilename(header.Filename), "fileSize": len(data)})
}

func validateUploadedChatMedia(declared, detected string, data []byte) (string, string, error) {
	// Match known file signatures. WebM audio is often detected as video/webm by browsers,
	// so an explicitly audio/webm declaration is retained for a valid EBML/WebM container.
	if detected == "application/octet-stream" && declared == "audio/webm" && len(data) >= 4 && string(data[:4]) == "\x1a\x45\xdf\xa3" {
		detected = "audio/webm"
	}
	if detected == "video/webm" && declared == "audio/webm" {
		detected = "audio/webm"
	}
	// Safari can record audio in an ISO-BMFF container that the generic sniffer
	// calls video/mp4. Keep it as audio only when the browser declared audio/mp4.
	if detected == "video/mp4" && declared == "audio/mp4" {
		detected = "audio/mp4"
	}
	switch detected {
	case "image/jpeg":
		return detected, ".jpg", nil
	case "image/png":
		return detected, ".png", nil
	case "image/gif":
		return detected, ".gif", nil
	case "image/webp":
		return detected, ".webp", nil
	case "video/mp4":
		return detected, ".mp4", nil
	case "video/webm":
		return detected, ".webm", nil
	case "audio/webm":
		return detected, ".weba", nil
	case "audio/ogg", "application/ogg":
		return "audio/ogg", ".ogg", nil
	case "audio/mp4":
		return detected, ".m4a", nil
	case "audio/mpeg":
		return detected, ".mp3", nil
	case "audio/wav", "audio/x-wav":
		return "audio/wav", ".wav", nil
	default:
		return "", "", fmt.Errorf("That file type is not supported. Use JPG, PNG, GIF, WebP, MP4, WebM or a browser-recorded voice note.")
	}
}

// CommunityChatMediaHandler serves only the opaque, server-generated filenames above.
func CommunityChatMediaHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := communityCurrentUserID(r); !ok {
		http.Error(w, "Sign in to view Community media.", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/community-media/")
	if filepath.Base(name) != name || !chatMediaFilenamePattern.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	root := strings.TrimSpace(os.Getenv("MOVIPILOT_CHAT_MEDIA_DIR"))
	if root == "" {
		root = "community-chat-media"
	}
	path := filepath.Join(root, name)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "Unable to read media", http.StatusInternalServerError)
		}
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	ext := filepath.Ext(name)
	mimeByExtension := map[string]string{".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".weba": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav"}
	w.Header().Set("Content-Type", mimeByExtension[ext])
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// Movie search uses a TMDB key or read access token already provided by the app environment.
// GET /api/community/chat/movies?q=arrival
func CommunityChatMovieSearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCommunityError(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := communityCurrentUserID(r); !ok {
		writeCommunityError(w, "Your session has expired. Please sign in again.", http.StatusUnauthorized)
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 || len([]rune(query)) > 100 {
		writeCommunityError(w, "Enter 2 to 100 characters of a movie title.", http.StatusBadRequest)
		return
	}
	apiKey := strings.TrimSpace(os.Getenv("TMDB_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("TMDB_TOKEN"))
	}
	bearer := strings.TrimSpace(os.Getenv("TMDB_READ_ACCESS_TOKEN"))
	if bearer == "" {
		bearer = strings.TrimSpace(os.Getenv("TMDB_BEARER_TOKEN"))
	}
	if apiKey == "" && bearer == "" {
		writeCommunityError(w, "Movie sharing needs TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN configured on the server.", http.StatusServiceUnavailable)
		return
	}
	endpoint := "https://api.themoviedb.org/3/search/movie?include_adult=false&language=en-US&page=1&query=" + url.QueryEscape(query)
	if apiKey != "" {
		endpoint += "&api_key=" + url.QueryEscape(apiKey)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 7*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeCommunityError(w, "Movie search could not be prepared.", http.StatusInternalServerError)
		return
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := &http.Client{Timeout: 8 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		writeCommunityError(w, "Movie search is temporarily unavailable.", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeCommunityError(w, "TMDB could not complete movie search.", http.StatusBadGateway)
		return
	}
	var result struct {
		Results []struct {
			ID          int64  `json:"id"`
			Title       string `json:"title"`
			Overview    string `json:"overview"`
			ReleaseDate string `json:"release_date"`
			PosterPath  string `json:"poster_path"`
		} `json:"results"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil {
		writeCommunityError(w, "Movie search returned an invalid response.", http.StatusBadGateway)
		return
	}
	movies := make([]chatMovieDTO, 0, 8)
	for _, row := range result.Results {
		if row.ID <= 0 || strings.TrimSpace(row.Title) == "" {
			continue
		}
		poster := ""
		if row.PosterPath != "" {
			poster = "https://image.tmdb.org/t/p/w342" + row.PosterPath
		}
		movies = append(movies, chatMovieDTO{ID: row.ID, Title: row.Title, PosterURL: poster, Overview: limitChatText(row.Overview, 600), ReleaseDate: row.ReleaseDate, ExploreURL: fmt.Sprintf("/explore?type=movie&id=%d", row.ID)})
		if len(movies) >= 8 {
			break
		}
	}
	writeCommunityJSON(w, http.StatusOK, map[string]any{"success": true, "movies": movies})
}

// The process-local SSE hub broadcasts lightweight invalidation events. Message
// content remains in SQLite; clients fetch authorized message DTOs over HTTP.
type communityChatEvent struct {
	Type string `json:"type"`
	ID   int64  `json:"id,omitempty"`
}
type communityChatEventHub struct {
	mu        sync.Mutex
	listeners map[chan communityChatEvent]struct{}
}

var communityChatHub = communityChatEventHub{listeners: make(map[chan communityChatEvent]struct{})}

func (h *communityChatEventHub) subscribe() (chan communityChatEvent, func()) {
	channel := make(chan communityChatEvent, 32)
	h.mu.Lock()
	h.listeners[channel] = struct{}{}
	h.mu.Unlock()
	return channel, func() { h.mu.Lock(); delete(h.listeners, channel); h.mu.Unlock() }
}
func broadcastCommunityChatEvent(kind string, id int64) {
	event := communityChatEvent{Type: kind, ID: id}
	communityChatHub.mu.Lock()
	defer communityChatHub.mu.Unlock()
	for listener := range communityChatHub.listeners {
		select {
		case listener <- event:
		default:
			select {
			case <-listener:
			default:
			}
			select {
			case listener <- communityChatEvent{Type: "refresh", ID: id}:
			default:
			}
		}
	}
}

// CommunityChatEventsHandler streams lightweight server-sent events for room changes.
// The browser uses the existing same-origin session cookie for authentication.
func CommunityChatEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	viewerID, ok := communityCurrentUserID(r)
	if !ok {
		http.Error(w, "Your session has expired.", http.StatusUnauthorized)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Live chat is not supported by this server.", http.StatusInternalServerError)
		return
	}
	afterID, err := parseOptionalChatID(r.URL.Query().Get("after"))
	if err != nil {
		http.Error(w, "Invalid message cursor", http.StatusBadRequest)
		return
	}
	listener, unsubscribe := communityChatHub.subscribe()
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	_, _ = io.WriteString(w, "retry: 3000\n\n")
	flusher.Flush()
	messages, catchupErr := storage.ListCommunityChatMessages(viewerID, afterID, 0, 100)
	if catchupErr == nil && len(messages) > 0 {
		if !writeChatSSE(w, flusher, communityChatEvent{Type: "sync", ID: messages[len(messages)-1].ID}) {
			return
		}
	}
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-listener:
			if !writeChatSSE(w, flusher, event) {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
func writeChatSSE(w http.ResponseWriter, flusher http.Flusher, event communityChatEvent) bool {
	payload, err := json.Marshal(event)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		return false
	}
	flusher.Flush()
	return true
}