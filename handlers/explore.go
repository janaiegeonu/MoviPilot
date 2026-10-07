package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"MoviPilot/funcs/storage"

	"github.com/benlei/go-tmdb/v2"
)

const (
	exploreDetailCacheTTL      = 15 * time.Minute
	exploreRecommendationLimit = 18
	exploreCastLimit           = 18
	exploreVideoLimit          = 30
)

type ExploreMedia struct {
	ID                  int64
	MediaType           string
	IsTV                bool
	Title               string
	OriginalTitle       string
	PosterURL           string
	BackdropURL         string
	Year                string
	ReleaseDate         string
	Runtime             string
	Seasons             int
	Episodes            int
	Genres              []string
	Tagline             string
	Overview            string
	OriginalLanguage    string
	Status              string
	MediaTypeLabel      string
	Type                string
	Popularity          float32
	VoteAverage         float32
	VoteCount           int64
	Budget              int64
	Revenue             int64
	BudgetLabel         string
	RevenueLabel        string
	Homepage            string
	IMDbURL             string
	Certification       string
	ProductionCompanies []string
	ProductionCountries []string
	SpokenLanguages     []string
	OriginCountries     []string
	Networks            []string
	CreatedBy           []string
	LastAirDate         string
	NextEpisodeDate     string
	NextEpisodeName     string
	PrimaryTrailer      *ExploreVideo
	Cast                []ExploreCast
	Videos              []ExploreVideo
	Recommendations     []ExploreRecommendation
	Keywords            []ExploreKeyword
	Collection          *ExploreCollection
	TVSeasons           []ExploreSeason
}

type ExploreCast struct {
	ID         int64
	Name       string
	Character  string
	ProfileURL string
	Order      int
}

type ExploreVideo struct {
	ID           string
	Name         string
	Key          string
	Type         string
	Official     bool
	Site         string
	ThumbnailURL string
	PublishedAt  string
}

type ExploreRecommendation struct {
	ID          int64
	Title       string
	MediaType   string
	PosterURL   string
	BackdropURL string
	Year        string
	Rating      float32
	Genre       string
}

type ExploreKeyword struct {
	ID   int64
	Name string
}

type ExploreCollection struct {
	ID          int64
	Name        string
	Overview    string
	PosterURL   string
	BackdropURL string
	Parts       []ExploreRecommendation
}

type ExploreSeason struct {
	ID           int64
	Name         string
	Number       int
	EpisodeCount int
	AirDate      string
	Overview     string
	PosterURL    string
}

type ExplorePageData struct {
	Media        ExploreMedia
	Community    storage.ExploreCommunity
	User         storage.ExploreUserState
	LoggedIn     bool
	TMDBBaseNote string
}

type exploreCacheEntry struct {
	ExpiresAt time.Time
	Media     ExploreMedia
}

var exploreDetailCache = struct {
	sync.RWMutex
	Items map[string]exploreCacheEntry
}{
	Items: make(map[string]exploreCacheEntry),
}

func ExplorePageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mediaType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
	if mediaType == "" {
		mediaType = "movie"
	}
	if mediaType != "movie" && mediaType != "tv" {
		http.Error(w, "Invalid Explore media type", http.StatusBadRequest)
		return
	}

	mediaID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
	if err != nil || mediaID <= 0 {
		http.Error(w, "Invalid Explore media id", http.StatusBadRequest)
		return
	}

	media, err := getExploreMedia(mediaType, mediaID)
	if err != nil {
		fmt.Println("[EXPLORE TMDB ERROR]", err)
		http.Error(w, "Could not load this title from TMDB", http.StatusBadGateway)
		return
	}

	userID, loggedIn := CurrentUserID(r)
	community, err := storage.GetExploreCommunity(mediaType, mediaID, userID, loggedIn)
	if err != nil {
		fmt.Println("[EXPLORE COMMUNITY ERROR]", err)
		http.Error(w, "Could not load MoviPilot community data", http.StatusInternalServerError)
		return
	}

	userState := storage.ExploreUserState{LoggedIn: loggedIn}
	if loggedIn {
		userState, err = storage.GetExploreUserState(userID, mediaType, mediaID)
		if err != nil {
			fmt.Println("[EXPLORE USER STATE ERROR]", err)
			http.Error(w, "Could not load your MoviPilot state", http.StatusInternalServerError)
			return
		}
	}

	data := ExplorePageData{
		Media:        media,
		Community:    community,
		User:         userState,
		LoggedIn:     loggedIn,
		TMDBBaseNote: "Movie and television metadata powered by TMDB.",
	}

	tmpl, err := template.ParseFiles("templates/explore_page.html")
	if err != nil {
		fmt.Println("[EXPLORE TEMPLATE PARSE ERROR]", err)
		http.Error(w, "Could not load Explore page", http.StatusInternalServerError)
		return
	}

	var buffer bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buffer, "explore_page", data); err != nil {
		fmt.Println("[EXPLORE TEMPLATE ERROR]", err)
		http.Error(w, "Could not render Explore page", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(buffer.Bytes()); err != nil {
		fmt.Println("[EXPLORE RESPONSE ERROR]", err)
	}
}

func getExploreMedia(mediaType string, id int64) (ExploreMedia, error) {
	cacheKey := fmt.Sprintf("%s:%d", mediaType, id)
	if cached, ok := getExploreCached(cacheKey); ok {
		return cached, nil
	}

	client, err := newMovieTMDBClient()
	if err != nil {
		return ExploreMedia{}, err
	}

	var media ExploreMedia
	switch mediaType {
	case "movie":
		media, err = getExploreMovie(client, id)
	case "tv":
		media, err = getExploreTV(client, id)
	default:
		err = errors.New("unsupported media type")
	}
	if err != nil {
		return ExploreMedia{}, err
	}

	saveExploreCached(cacheKey, media)
	return media, nil
}

func getExploreMovie(client *tmdb.Client, id int64) (ExploreMedia, error) {
	details, err := client.GetMovieDetails(id, map[string]string{
		"language":           "en-US",
		"append_to_response": "credits,videos,keywords,recommendations,external_ids,release_dates",
	})
	if err != nil {
		return ExploreMedia{}, err
	}
	if details == nil || details.ID <= 0 {
		return ExploreMedia{}, errors.New("TMDB returned no movie details")
	}

	media := ExploreMedia{
		ID:                  details.ID,
		MediaType:           "movie",
		MediaTypeLabel:      "Movie",
		IsTV:                false,
		Title:               strings.TrimSpace(details.Title),
		OriginalTitle:       strings.TrimSpace(details.OriginalTitle),
		PosterURL:           imageURL(details.PosterPath, tmdb.W500),
		BackdropURL:         imageURL(details.BackdropPath, tmdb.W1280),
		Year:                formatYear(details.ReleaseDate),
		ReleaseDate:         formatFullDate(details.ReleaseDate),
		Runtime:             formatMinutes(details.Runtime),
		Tagline:             strings.TrimSpace(details.Tagline),
		Overview:            strings.TrimSpace(details.Overview),
		OriginalLanguage:    strings.TrimSpace(details.OriginalLanguage),
		Status:              strings.TrimSpace(details.Status),
		Popularity:          details.Popularity,
		VoteAverage:         details.VoteAverage,
		VoteCount:           details.VoteCount,
		Budget:              details.Budget,
		Revenue:             details.Revenue,
		BudgetLabel:         formatMoney(details.Budget),
		RevenueLabel:        formatMoney(details.Revenue),
		Homepage:            strings.TrimSpace(details.Homepage),
		ProductionCompanies: movieCompanyNames(details.ProductionCompanies),
		ProductionCountries: movieCountryNames(details.ProductionCountries),
		SpokenLanguages:     movieLanguageNames(details.SpokenLanguages),
	}
	if media.Title == "" {
		media.Title = media.OriginalTitle
	}

	if details.ExternalIDs != nil && strings.TrimSpace(details.ExternalIDs.IMDbID) != "" {
		media.IMDbURL = "https://www.imdb.com/title/" + strings.TrimSpace(details.ExternalIDs.IMDbID) + "/"
	}

	for _, genre := range details.Genres {
		if genre != nil && strings.TrimSpace(genre.Name) != "" {
			media.Genres = append(media.Genres, strings.TrimSpace(genre.Name))
		}
	}
	media.Certification = movieUSCertification(details)

	if details.MovieCreditsAppend != nil && details.MovieCreditsAppend.Credits != nil {
		for _, cast := range details.MovieCreditsAppend.Credits.Cast {
			if cast == nil || cast.ID <= 0 || strings.TrimSpace(cast.Name) == "" {
				continue
			}
			media.Cast = append(media.Cast, ExploreCast{
				ID:         cast.ID,
				Name:       strings.TrimSpace(cast.Name),
				Character:  strings.TrimSpace(cast.Character),
				ProfileURL: imageURL(cast.ProfilePath, tmdb.W185),
				Order:      cast.Order,
			})
			if len(media.Cast) >= exploreCastLimit {
				break
			}
		}
	}

	if details.MovieVideosAppend != nil && details.MovieVideosAppend.Videos != nil && details.MovieVideosAppend.Videos.MovieVideos != nil {
		for _, video := range details.MovieVideosAppend.Videos.MovieVideos.Results {
			if video == nil || strings.TrimSpace(video.Key) == "" {
				continue
			}
			item := ExploreVideo{
				ID:           video.ID,
				Name:         strings.TrimSpace(video.Name),
				Key:          strings.TrimSpace(video.Key),
				Type:         strings.TrimSpace(video.Type),
				Official:     video.Official,
				Site:         strings.TrimSpace(video.Site),
				ThumbnailURL: youtubeThumb(video.Key),
				PublishedAt:  strings.TrimSpace(video.PublishedAt),
			}
			media.Videos = append(media.Videos, item)
			if len(media.Videos) >= exploreVideoLimit {
				break
			}
		}
	}
	media.PrimaryTrailer = choosePrimaryTrailer(media.Videos)

	if details.MovieKeywordsAppend != nil && details.MovieKeywordsAppend.Keywords != nil {
		for _, keyword := range details.MovieKeywordsAppend.Keywords.Keywords {
			if keyword != nil && keyword.ID > 0 && strings.TrimSpace(keyword.Name) != "" {
				media.Keywords = append(media.Keywords, ExploreKeyword{
					ID:   keyword.ID,
					Name: strings.TrimSpace(keyword.Name),
				})
			}
		}
	}

	if details.MovieRecommendationsAppend != nil && details.MovieRecommendationsAppend.Recommendations != nil && details.MovieRecommendationsAppend.Recommendations.MovieRecommendationsResults != nil {
		for _, rec := range details.MovieRecommendationsAppend.Recommendations.MovieRecommendationsResults.Results {
			if rec == nil || rec.ID <= 0 || strings.TrimSpace(rec.Title) == "" {
				continue
			}
			media.Recommendations = append(media.Recommendations, ExploreRecommendation{
				ID:          rec.ID,
				Title:       strings.TrimSpace(rec.Title),
				MediaType:   "movie",
				PosterURL:   imageURL(rec.PosterPath, tmdb.W342),
				BackdropURL: imageURL(rec.BackdropPath, tmdb.W780),
				Year:        formatYear(rec.ReleaseDate),
				Rating:      rec.VoteAverage,
				Genre:       firstMovieGenre(rec.GenreIDs),
			})
			if len(media.Recommendations) >= exploreRecommendationLimit {
				break
			}
		}
	}

	if details.BelongsToCollection != nil && details.BelongsToCollection.ID > 0 {
		collection, collectionErr := client.GetCollectionDetails(
			details.BelongsToCollection.ID,
			map[string]string{"language": "en-US"},
		)
		if collectionErr == nil && collection != nil {
			media.Collection = normalizeCollection(collection)
		}
	}

	return media, nil
}

func getExploreTV(client *tmdb.Client, id int64) (ExploreMedia, error) {
	details, err := client.GetTVDetails(id, map[string]string{
		"language":           "en-US",
		"append_to_response": "credits,videos,keywords,recommendations,external_ids,content_ratings",
	})
	if err != nil {
		return ExploreMedia{}, err
	}
	if details == nil || details.ID <= 0 {
		return ExploreMedia{}, errors.New("TMDB returned no TV details")
	}

	media := ExploreMedia{
		ID:                  details.ID,
		MediaType:           "tv",
		MediaTypeLabel:      "Series",
		IsTV:                true,
		Title:               strings.TrimSpace(details.Name),
		OriginalTitle:       strings.TrimSpace(details.OriginalName),
		PosterURL:           imageURL(details.PosterPath, tmdb.W500),
		BackdropURL:         imageURL(details.BackdropPath, tmdb.W1280),
		Year:                formatYear(details.FirstAirDate),
		ReleaseDate:         formatFullDate(details.FirstAirDate),
		Runtime:             firstRuntime(details.EpisodeRunTime),
		Seasons:             details.NumberOfSeasons,
		Episodes:            details.NumberOfEpisodes,
		Tagline:             strings.TrimSpace(details.Tagline),
		Overview:            strings.TrimSpace(details.Overview),
		OriginalLanguage:    strings.TrimSpace(details.OriginalLanguage),
		Status:              strings.TrimSpace(details.Status),
		Type:                strings.TrimSpace(details.Type),
		Popularity:          details.Popularity,
		VoteAverage:         details.VoteAverage,
		VoteCount:           details.VoteCount,
		Homepage:            strings.TrimSpace(details.Homepage),
		ProductionCompanies: tvCompanyNames(details.ProductionCompanies),
		ProductionCountries: tvCountryNames(details.ProductionCountries),
		OriginCountries:     append([]string(nil), details.OriginCountry...),
		Networks:            tvNetworkNames(details.Networks),
		LastAirDate:         formatFullDate(details.LastAirDate),
	}
	if media.Title == "" {
		media.Title = media.OriginalTitle
	}

	for _, creator := range details.CreatedBy {
		if creator != nil && strings.TrimSpace(creator.Name) != "" {
			media.CreatedBy = append(media.CreatedBy, strings.TrimSpace(creator.Name))
		}
	}

	if details.ExternalIDs != nil && strings.TrimSpace(details.ExternalIDs.IMDbID) != "" {
		media.IMDbURL = "https://www.imdb.com/title/" + strings.TrimSpace(details.ExternalIDs.IMDbID) + "/"
	}

	for _, genre := range details.Genres {
		if genre != nil && strings.TrimSpace(genre.Name) != "" {
			media.Genres = append(media.Genres, strings.TrimSpace(genre.Name))
		}
	}
	media.Certification = tvUSCertification(details)

	if details.TVCreditsAppend != nil && details.TVCreditsAppend.Credits != nil {
		for _, cast := range details.TVCreditsAppend.Credits.Cast {
			if cast == nil || cast.ID <= 0 || strings.TrimSpace(cast.Name) == "" {
				continue
			}
			media.Cast = append(media.Cast, ExploreCast{
				ID:         cast.ID,
				Name:       strings.TrimSpace(cast.Name),
				Character:  strings.TrimSpace(cast.Character),
				ProfileURL: imageURL(cast.ProfilePath, tmdb.W185),
				Order:      cast.Order,
			})
			if len(media.Cast) >= exploreCastLimit {
				break
			}
		}
	}

	if details.TVVideosAppend != nil && details.TVVideosAppend.Videos != nil && details.TVVideosAppend.Videos.TVVideos != nil {
		for _, video := range details.TVVideosAppend.Videos.TVVideos.Results {
			if video == nil || strings.TrimSpace(video.Key) == "" {
				continue
			}
			media.Videos = append(media.Videos, ExploreVideo{
				ID:           video.ID,
				Name:         strings.TrimSpace(video.Name),
				Key:          strings.TrimSpace(video.Key),
				Type:         strings.TrimSpace(video.Type),
				Official:     video.Official,
				Site:         strings.TrimSpace(video.Site),
				ThumbnailURL: youtubeThumb(video.Key),
				PublishedAt:  strings.TrimSpace(video.PublishedAt),
			})
			if len(media.Videos) >= exploreVideoLimit {
				break
			}
		}
	}
	media.PrimaryTrailer = choosePrimaryTrailer(media.Videos)

	if details.TVKeywordsAppend != nil && details.TVKeywordsAppend.Keywords != nil && details.TVKeywordsAppend.Keywords.TVKeywordsResults != nil {
		for _, keyword := range details.TVKeywordsAppend.Keywords.TVKeywordsResults.Results {
			if keyword != nil && keyword.ID > 0 && strings.TrimSpace(keyword.Name) != "" {
				media.Keywords = append(media.Keywords, ExploreKeyword{
					ID:   keyword.ID,
					Name: strings.TrimSpace(keyword.Name),
				})
			}
		}
	}

	if details.TVRecommendationsAppend != nil && details.TVRecommendationsAppend.Recommendations != nil && details.TVRecommendationsAppend.Recommendations.TVRecommendationsResults != nil {
		for _, rec := range details.TVRecommendationsAppend.Recommendations.TVRecommendationsResults.Results {
			if rec == nil || rec.ID <= 0 || strings.TrimSpace(rec.Name) == "" {
				continue
			}
			media.Recommendations = append(media.Recommendations, ExploreRecommendation{
				ID:          rec.ID,
				Title:       strings.TrimSpace(rec.Name),
				MediaType:   "tv",
				PosterURL:   imageURL(rec.PosterPath, tmdb.W342),
				BackdropURL: imageURL(rec.BackdropPath, tmdb.W780),
				Year:        formatYear(rec.FirstAirDate),
				Rating:      rec.VoteAverage,
				Genre:       firstTVGenre(rec.GenreIDs),
			})
			if len(media.Recommendations) >= exploreRecommendationLimit {
				break
			}
		}
	}

	for _, season := range details.Seasons {
		if season == nil || season.ID <= 0 || season.SeasonNumber == 0 {
			continue
		}
		media.TVSeasons = append(media.TVSeasons, ExploreSeason{
			ID:           season.ID,
			Name:         strings.TrimSpace(season.Name),
			Number:       season.SeasonNumber,
			EpisodeCount: season.EpisodeCount,
			AirDate:      formatFullDate(season.AirDate),
			Overview:     strings.TrimSpace(season.Overview),
			PosterURL:    imageURL(season.PosterPath, tmdb.W342),
		})
	}

	if details.NextEpisodeToAir != nil {
		media.NextEpisodeDate = formatFullDate(details.NextEpisodeToAir.AirDate)
		media.NextEpisodeName = strings.TrimSpace(details.NextEpisodeToAir.Name)
	}

	sort.SliceStable(media.TVSeasons, func(i, j int) bool {
		return media.TVSeasons[i].Number < media.TVSeasons[j].Number
	})

	return media, nil
}

func choosePrimaryTrailer(videos []ExploreVideo) *ExploreVideo {
	bestScore := -1
	var best *ExploreVideo
	for i := range videos {
		video := videos[i]
		if !strings.EqualFold(video.Site, "YouTube") {
			continue
		}
		score := 0
		if video.Official {
			score += 4
		}
		if strings.EqualFold(video.Type, "Trailer") {
			score += 5
		}
		if score > bestScore {
			candidate := video
			best = &candidate
			bestScore = score
		}
	}
	return best
}

func normalizeCollection(collection *tmdb.CollectionDetails) *ExploreCollection {
	if collection == nil {
		return nil
	}
	out := &ExploreCollection{
		ID:          collection.ID,
		Name:        strings.TrimSpace(collection.Name),
		Overview:    strings.TrimSpace(collection.Overview),
		PosterURL:   imageURL(collection.PosterPath, tmdb.W500),
		BackdropURL: imageURL(collection.BackdropPath, tmdb.W1280),
	}
	for _, part := range collection.Parts {
		if part == nil || part.ID <= 0 || strings.TrimSpace(part.Title) == "" {
			continue
		}
		out.Parts = append(out.Parts, ExploreRecommendation{
			ID:          part.ID,
			Title:       strings.TrimSpace(part.Title),
			MediaType:   "movie",
			PosterURL:   imageURL(part.PosterPath, tmdb.W342),
			BackdropURL: imageURL(part.BackdropPath, tmdb.W780),
			Year:        formatYear(part.ReleaseDate),
			Rating:      part.VoteAverage,
			Genre:       firstMovieGenre(part.GenreIDs),
		})
	}
	return out
}

func getExploreCached(key string) (ExploreMedia, bool) {
	exploreDetailCache.RLock()
	entry, ok := exploreDetailCache.Items[key]
	exploreDetailCache.RUnlock()
	if !ok || time.Now().After(entry.ExpiresAt) {
		return ExploreMedia{}, false
	}
	return entry.Media, true
}

func saveExploreCached(key string, media ExploreMedia) {
	exploreDetailCache.Lock()
	exploreDetailCache.Items[key] = exploreCacheEntry{
		ExpiresAt: time.Now().Add(exploreDetailCacheTTL),
		Media:     media,
	}
	exploreDetailCache.Unlock()
}

func imageURL(path string, size string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	return tmdb.GetImageURL(path, size)
}

func youtubeThumb(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	return "https://i.ytimg.com/vi/" + key + "/hqdefault.jpg"
}

func formatMoney(value int64) string {
	if value <= 0 {
		return ""
	}
	raw := strconv.FormatInt(value, 10)
	start := 0
	if raw[0] == '-' {
		start = 1
	}
	for i := len(raw) - 3; i > start; i -= 3 {
		raw = raw[:i] + "," + raw[i:]
	}
	return "$" + raw
}

func formatMinutes(minutes int) string {
	if minutes <= 0 {
		return ""
	}
	h := minutes / 60
	m := minutes % 60
	if h == 0 {
		return fmt.Sprintf("%dm", m)
	}
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh %dm", h, m)
}

func firstRuntime(values []int) string {
	for _, value := range values {
		if value > 0 {
			return formatMinutes(value)
		}
	}
	return ""
}

func formatYear(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) >= 4 {
		return raw[:4]
	}
	return ""
}

func formatFullDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if len(raw) == 10 {
		parts := strings.Split(raw, "-")
		if len(parts) == 3 {
			return parts[2] + " " + monthName(parts[1]) + " " + parts[0]
		}
	}
	return raw
}

func monthName(month string) string {
	months := map[string]string{
		"01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
		"07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
	}
	return months[month]
}

func movieCompanyNames(values []*tmdb.MovieProductionCompany) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func movieCountryNames(values []*tmdb.MovieProductionCountry) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func movieLanguageNames(values []*tmdb.MovieSpokenLanguage) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func tvCompanyNames(values []*tmdb.TVProductionCompany) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func tvCountryNames(values []*tmdb.TVProductionCountry) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func tvNetworkNames(values []*tmdb.TVNetwork) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != nil && strings.TrimSpace(value.Name) != "" {
			out = append(out, strings.TrimSpace(value.Name))
		}
	}
	return uniqueStrings(out)
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func movieUSCertification(details *tmdb.MovieDetails) string {
	if details == nil || details.MovieReleaseDatesAppend == nil || details.MovieReleaseDatesAppend.ReleaseDates == nil || details.MovieReleaseDatesAppend.ReleaseDates.MovieReleaseDatesResults == nil {
		return ""
	}
	for _, country := range details.MovieReleaseDatesAppend.ReleaseDates.MovieReleaseDatesResults.Results {
		if country == nil || country.CountryCode != "US" {
			continue
		}
		for _, release := range country.ReleaseDates {
			if release != nil && strings.TrimSpace(release.Certification) != "" {
				return strings.TrimSpace(release.Certification)
			}
		}
	}
	return ""
}

func tvUSCertification(details *tmdb.TVDetails) string {
	if details == nil || details.TVContentRatingsAppend == nil || details.TVContentRatingsAppend.ContentRatings == nil || details.TVContentRatingsAppend.ContentRatings.TVContentRatingsResults == nil {
		return ""
	}
	for _, rating := range details.TVContentRatingsAppend.ContentRatings.TVContentRatingsResults.Results {
		if rating != nil && rating.CountryCode == "US" && strings.TrimSpace(rating.Rating) != "" {
			return strings.TrimSpace(rating.Rating)
		}
	}
	return ""
}

func firstMovieGenre(ids []int64) string {
	mapping := map[int64]string{
		28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller", 10752: "War", 37: "Western",
	}
	for _, id := range ids {
		if value := mapping[id]; value != "" {
			return value
		}
	}
	return "Movie"
}

func firstTVGenre(ids []int64) string {
	mapping := map[int64]string{
		10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
	}
	for _, id := range ids {
		if value := mapping[id]; value != "" {
			return value
		}
	}
	return "Series"
}

/* =========================================================
   EXPLORE SOCIAL/PERSONAL APIs
   ========================================================= */

type exploreMediaRequest struct {
	MediaType string `json:"media_type"`
	MediaID   int64  `json:"media_id"`
}

type exploreRatingRequest struct {
	MediaType string `json:"media_type"`
	MediaID   int64  `json:"media_id"`
	Rating    int    `json:"rating"`
}

type exploreReviewRequest struct {
	MediaType string `json:"media_type"`
	MediaID   int64  `json:"media_id"`
	Review    string `json:"review"`
}

type exploreCollectionRequest struct {
	Name string `json:"name"`
}

type exploreCollectionItemRequest struct {
	CollectionID int64  `json:"collection_id"`
	MediaType    string `json:"media_type"`
	MediaID      int64  `json:"media_id"`
}

type exploreWatchEventRequest struct {
	MediaType string `json:"media_type"`
	MediaID   int64  `json:"media_id"`
	Source    string `json:"source"`
}

func ExploreStateAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mediaType, mediaID, err := parseExploreQuery(r)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	userID, loggedIn := CurrentUserID(r)
	community, err := storage.GetExploreCommunity(mediaType, mediaID, userID, loggedIn)
	if err != nil {
		jsonError(w, "Could not load community state", http.StatusInternalServerError)
		return
	}
	state := storage.ExploreUserState{LoggedIn: loggedIn}
	if loggedIn {
		state, err = storage.GetExploreUserState(userID, mediaType, mediaID)
		if err != nil {
			jsonError(w, "Could not load user state", http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, map[string]interface{}{
		"success":   true,
		"community": community,
		"user":      state,
	})
}

func ExploreWatchlistAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreMediaRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	watchlisted, err := storage.ToggleExploreWatchlist(userID, req.MediaType, req.MediaID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "watchlisted": watchlisted})
}

func ExploreLikeAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreMediaRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	liked, count, err := storage.ToggleExploreLike(userID, req.MediaType, req.MediaID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "liked": liked, "like_count": count})
}

func ExploreRatingAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreRatingRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := storage.SaveExploreRating(userID, req.MediaType, req.MediaID, req.Rating); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "rating": req.Rating})
}

func ExploreReviewAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreReviewRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := storage.CreateExploreReview(userID, req.MediaType, req.MediaID, req.Review); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}

func ExploreWatchEventAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreWatchEventRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := storage.RecordExploreWatchEvent(userID, req.MediaType, req.MediaID, req.Source); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}

func ExploreCollectionsAPI(w http.ResponseWriter, r *http.Request) {
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	switch r.Method {
	case http.MethodGet:
		collections, err := storage.GetExploreCollections(userID)
		if err != nil {
			jsonError(w, "Could not load collections", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]interface{}{"success": true, "collections": collections})
	case http.MethodPost:
		var req exploreCollectionRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		collection, err := storage.CreateExploreCollection(userID, req.Name)
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]interface{}{"success": true, "collection": collection})
	default:
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func ExploreCollectionItemsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, loggedIn := requireExploreUser(w, r)
	if !loggedIn {
		return
	}
	var req exploreCollectionItemRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := storage.AddExploreCollectionItem(userID, req.CollectionID, req.MediaType, req.MediaID); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}

func ExploreKeywordMoviesAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	keywordID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("keyword_id")), 10, 64)
	if err != nil || keywordID <= 0 {
		jsonError(w, "Invalid keyword id", http.StatusBadRequest)
		return
	}
	client, err := newMovieTMDBClient()
	if err != nil {
		jsonError(w, "TMDB is not configured", http.StatusInternalServerError)
		return
	}
	results, err := client.GetKeywordMovies(keywordID, map[string]string{
		"language": "en-US",
		"page":     "1",
	})
	if err != nil {
		jsonError(w, "Could not fetch keyword recommendations", http.StatusBadGateway)
		return
	}
	cards := make([]ExploreRecommendation, 0, 12)
	for _, movie := range results.Results {
		if movie == nil || movie.ID <= 0 || strings.TrimSpace(movie.Title) == "" {
			continue
		}
		cards = append(cards, ExploreRecommendation{
			ID:          movie.ID,
			Title:       strings.TrimSpace(movie.Title),
			MediaType:   "movie",
			PosterURL:   imageURL(movie.PosterPath, tmdb.W342),
			BackdropURL: imageURL(movie.BackdropPath, tmdb.W780),
			Year:        formatYear(movie.ReleaseDate),
			Rating:      movie.VoteAverage,
			Genre:       firstMovieGenre(movie.GenreIDs),
		})
		if len(cards) >= 12 {
			break
		}
	}
	writeJSON(w, map[string]interface{}{"success": true, "results": cards})
}

func PersonPageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	personID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
	if err != nil || personID <= 0 {
		http.Error(w, "Invalid person id", http.StatusBadRequest)
		return
	}
	client, err := newMovieTMDBClient()
	if err != nil {
		http.Error(w, "TMDB is not configured", http.StatusInternalServerError)
		return
	}
	person, err := client.GetPersonDetails(personID, map[string]string{
		"language":           "en-US",
		"append_to_response": "combined_credits,external_ids,images",
	})
	if err != nil || person == nil {
		http.Error(w, "Could not load person data", http.StatusBadGateway)
		return
	}

	type personCredit struct {
		ID        int64
		Title     string
		MediaType string
		Character string
		Year      string
		PosterURL string
		Rating    float32
	}

	credits := make([]personCredit, 0, 30)
	if person.PersonCombinedCreditsAppend != nil && person.PersonCombinedCreditsAppend.CombinedCredits != nil {
		for _, credit := range person.PersonCombinedCreditsAppend.CombinedCredits.Cast {
			if credit == nil || credit.ID <= 0 {
				continue
			}
			title := strings.TrimSpace(credit.Title)
			year := formatYear(credit.ReleaseDate)
			if credit.MediaType == "tv" {
				if strings.TrimSpace(credit.Name) != "" {
					title = strings.TrimSpace(credit.Name)
				}
				year = formatYear(credit.FirstAirDate)
			}
			credits = append(credits, personCredit{
				ID:        credit.ID,
				Title:     title,
				MediaType: credit.MediaType,
				Character: strings.TrimSpace(credit.Character),
				Year:      year,
				PosterURL: imageURL(credit.PosterPath, tmdb.W342),
				Rating:    credit.VoteAverage,
			})
		}
	}

	sort.SliceStable(credits, func(i, j int) bool {
		return credits[i].Year > credits[j].Year
	})
	if len(credits) > 30 {
		credits = credits[:30]
	}

	data := struct {
		ID           int64
		Name         string
		Biography    string
		Birthday     string
		Deathday     string
		PlaceOfBirth string
		KnownFor     string
		ProfileURL   string
		IMDbURL      string
		Credits      []personCredit
	}{
		ID:           person.ID,
		Name:         strings.TrimSpace(person.Name),
		Biography:    strings.TrimSpace(person.Biography),
		Birthday:     formatFullDate(person.Birthday),
		Deathday:     formatFullDate(person.Deathday),
		PlaceOfBirth: strings.TrimSpace(person.PlaceOfBirth),
		KnownFor:     strings.TrimSpace(person.KnownForDepartment),
		ProfileURL:   imageURL(person.ProfilePath, tmdb.W500),
		Credits:      credits,
	}
	if person.PersonExternalIDsAppend != nil && person.PersonExternalIDsAppend.ExternalIDs != nil && strings.TrimSpace(person.PersonExternalIDsAppend.ExternalIDs.IMDbID) != "" {
		data.IMDbURL = "https://www.imdb.com/name/" + strings.TrimSpace(person.PersonExternalIDsAppend.ExternalIDs.IMDbID) + "/"
	}

	tmpl, err := template.ParseFiles("templates/person_page.html")
	if err != nil {
		http.Error(w, "Could not load person page", http.StatusInternalServerError)
		return
	}
	var buffer bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buffer, "person_page", data); err != nil {
		http.Error(w, "Could not render person page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(buffer.Bytes()); err != nil {
		fmt.Println("[PERSON RESPONSE ERROR]", err)
	}
}

func parseExploreQuery(r *http.Request) (string, int64, error) {
	mediaType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
	if mediaType != "movie" && mediaType != "tv" {
		return "", 0, errors.New("invalid media type")
	}
	mediaID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
	if err != nil || mediaID <= 0 {
		return "", 0, errors.New("invalid media id")
	}
	return mediaType, mediaID, nil
}

func requireExploreUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	userID, loggedIn := CurrentUserID(r)
	if !loggedIn || userID <= 0 {
		jsonError(w, "Please log in to use this MoviPilot feature", http.StatusUnauthorized)
		return 0, false
	}
	return userID, true
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, destination interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(value)
}

func jsonError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
	})
}
