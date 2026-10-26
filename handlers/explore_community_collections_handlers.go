package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"MoviPilot/funcs/storage"
)

const collectionHubBasePath = "/api/explore/collection-hub"

// ExploreCommunityCollectionHubAPI loads the modal overview and creates
// user-owned folders. The existing Explore endpoints continue to add titles to
// the same movipilot_collections / movipilot_collection_items tables.
func ExploreCommunityCollectionHubAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		folders, err := storage.ListCollectionHubFolders(userID)
		if err != nil {
			jsonError(w, "Could not load your collection folders right now.", http.StatusInternalServerError)
			return
		}
		pending, err := storage.ListCollectionHubShares(userID, "pending")
		if err != nil {
			jsonError(w, "Could not load incoming collections right now.", http.StatusInternalServerError)
			return
		}
		shared, err := storage.ListCollectionHubShares(userID, "accepted")
		if err != nil {
			jsonError(w, "Could not load accepted collections right now.", http.StatusInternalServerError)
			return
		}
		folderItems := 0
		for _, folder := range folders {
			folderItems += folder.ItemCount
		}
		writeJSON(w, map[string]interface{}{
			"success": true, "folders": folders, "pending": pending, "sharedWithMe": shared,
			"counts": map[string]int{"folders": len(folders), "ownedItems": folderItems, "pending": len(pending), "sharedWithMe": len(shared)},
		})

	case http.MethodPost:
		if !collectionHubSameOrigin(r) {
			jsonError(w, "This request could not be verified. Refresh the page and try again.", http.StatusForbidden)
			return
		}
		var req struct {
			Name string `json:"name"`
		}
		if !decodeJSONBody(w, r, &req) {
			return
		}
		folder, err := storage.CreateCollectionHubFolder(userID, req.Name)
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]interface{}{"success": true, "folder": folder})

	default:
		w.Header().Set("Allow", "GET, POST")
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ExploreCommunityCollectionFolderAPI reads one owned folder or deletes it.
// Only X/close dismisses the frontend modal; this endpoint has no UI coupling.
func ExploreCommunityCollectionFolderAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	folderID, err := positiveQueryID(r, "id")
	if err != nil {
		jsonError(w, "Choose a valid collection folder.", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := storage.ListCollectionHubFolderItems(userID, folderID)
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			jsonError(w, "Could not open this collection folder.", status)
			return
		}
		enrichCollectionHubItems(items)
		persistCollectionHubSnapshots(items)
		writeJSON(w, map[string]interface{}{"success": true, "items": items, "count": len(items)})

	case http.MethodDelete:
		if !collectionHubSameOrigin(r) {
			jsonError(w, "This request could not be verified.", http.StatusForbidden)
			return
		}
		deleted, err := storage.DeleteCollectionHubFolder(userID, folderID)
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			jsonError(w, err.Error(), status)
			return
		}
		writeJSON(w, map[string]interface{}{"success": true, "deleted": deleted})

	default:
		w.Header().Set("Allow", "GET, DELETE")
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ExploreCommunityCollectionItemAPI directly removes a title from a folder.
// It never uses the Explore add/toggle endpoint, so retries cannot re-add it.
func ExploreCommunityCollectionItemAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodDelete)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !collectionHubSameOrigin(r) {
		jsonError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	itemID, err := positiveQueryID(r, "id")
	if err != nil {
		jsonError(w, "Choose a valid collection item.", http.StatusBadRequest)
		return
	}
	removed, err := storage.RemoveCollectionHubFolderItem(userID, itemID)
	if err != nil {
		jsonError(w, "Could not remove this title from the folder.", http.StatusInternalServerError)
		return
	}
	if !removed {
		jsonError(w, "This title was not found in your collection folders.", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "removed": true})
}

// ExploreCommunityCollectionFriendsAPI lists only accounts the sender has
// marked as friends. Email addresses and internal user IDs are not returned.
func ExploreCommunityCollectionFriendsAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	friends, err := storage.ListCollectionHubMarkedFriends(userID)
	if err != nil {
		jsonError(w, "Could not load your marked-friends list.", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "friends": friends, "count": len(friends)})
}

// ExploreCommunityCollectionShareAPI shares a snapshot with one or more marked
// friends. Media details are enriched first so received snapshots are durable
// even if the sender later deletes their original folder.
func ExploreCommunityCollectionShareAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !collectionHubSameOrigin(r) {
		jsonError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	var req struct {
		CollectionID       int64    `json:"collectionId"`
		RecipientPublicIDs []string `json:"recipientPublicIDs"`
		Message            string   `json:"message"`
	}
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if req.CollectionID <= 0 {
		jsonError(w, "Choose a valid collection folder.", http.StatusBadRequest)
		return
	}
	items, err := storage.ListCollectionHubFolderItems(userID, req.CollectionID)
	if err != nil {
		jsonError(w, "Could not prepare this collection for sharing.", http.StatusBadRequest)
		return
	}
	enrichCollectionHubItems(items)
	persistCollectionHubSnapshots(items)
	sent, err := storage.ShareCollectionHubFolder(userID, req.CollectionID, req.RecipientPublicIDs, req.Message)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "sent": sent})
}

// ExploreCommunityCollectionRespondAPI accepts or declines a pending incoming
// collection. Only the addressed recipient can perform the transition.
func ExploreCommunityCollectionRespondAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !collectionHubSameOrigin(r) {
		jsonError(w, "This request could not be verified.", http.StatusForbidden)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	var req struct {
		ShareID int64  `json:"shareId"`
		Action  string `json:"action"`
	}
	if !decodeJSONBody(w, r, &req) {
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if err := storage.RespondToCollectionHubShare(userID, req.ShareID, action); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	status := "accepted"
	if action == "decline" {
		status = "declined"
	}
	writeJSON(w, map[string]interface{}{"success": true, "status": status})
}

// ExploreCommunityCollectionSharedItemsAPI permits item access only after the
// receiver has accepted that exact share.
func ExploreCommunityCollectionSharedItemsAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireExploreUser(w, r)
	if !ok {
		return
	}
	shareID, err := positiveQueryID(r, "id")
	if err != nil {
		jsonError(w, "Choose a valid shared collection.", http.StatusBadRequest)
		return
	}
	items, err := storage.ListAcceptedCollectionHubShareItems(userID, shareID)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(strings.ToLower(err.Error()), "unavailable") {
			status = http.StatusNotFound
		}
		jsonError(w, err.Error(), status)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "items": items, "count": len(items)})
}

func positiveQueryID(r *http.Request, key string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get(key)), 10, 64)
	if err != nil || id <= 0 {
		return 0, strconv.ErrSyntax
	}
	return id, nil
}

// collectionHubSameOrigin provides Origin/Referer verification and a Fetch
// Metadata cross-site rejection for state-changing browser requests. It is
// defense-in-depth alongside the app's authenticated session cookie.
func collectionHubSameOrigin(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
		return false
	}
	candidate := strings.TrimSpace(r.Header.Get("Origin"))
	if candidate == "" {
		candidate = strings.TrimSpace(r.Header.Get("Referer"))
	}
	if candidate == "" || r.Host == "" {
		return false
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Host == "" {
		return false
	}
	return strings.EqualFold(parsed.Host, r.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func enrichCollectionHubItems(items []storage.CollectionHubItem) {
	var group sync.WaitGroup
	semaphore := make(chan struct{}, 4)
	for index := range items {
		if strings.TrimSpace(items[index].Title) != "" {
			continue
		}
		group.Add(1)
		go func(index int) {
			defer group.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			item := &items[index]
			media, err := getExploreMedia(item.MediaType, item.MediaID)
			if err != nil || strings.TrimSpace(media.Title) == "" {
				return
			}
			item.Title = media.Title
			item.Overview = media.Overview
			item.PosterURL = media.PosterURL
			item.BackdropURL = media.BackdropURL
			item.Year = media.Year
			item.VoteAverage = float64(media.VoteAverage)
			item.MediaTypeLabel = media.MediaTypeLabel
		}(index)
	}
	group.Wait()
	for index := range items {
		if strings.TrimSpace(items[index].MediaTypeLabel) == "" {
			if items[index].MediaType == "tv" {
				items[index].MediaTypeLabel = "TV Series"
			} else {
				items[index].MediaTypeLabel = "Movie"
			}
		}
	}
}

func persistCollectionHubSnapshots(items []storage.CollectionHubItem) {
	for _, item := range items {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		_ = storage.StoreCollectionHubMediaSnapshot(item.MediaType, item.MediaID, item.Title, item.Overview, item.PosterURL, item.BackdropURL, item.Year, item.VoteAverage, item.MediaTypeLabel)
	}
}
