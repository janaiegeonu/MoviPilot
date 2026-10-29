package main

import (
	"MoviPilot/funcs/storage"
	"MoviPilot/handlers"
	"fmt"
	"log"
	"net/http"

	"github.com/joho/godotenv"
)

func main() {

	err := godotenv.Load()

	if err != nil {
		log.Println("Warning: .env file not found")
	}

	http.Handle("/templates/", http.StripPrefix("/templates/", http.FileServer(http.Dir("templates"))))
	http.Handle("/img/", http.StripPrefix("/img/", http.FileServer(http.Dir("img"))))
	http.HandleFunc("/", handlers.SplashIntro)
	http.HandleFunc("/homepage", handlers.HomepageHandler)
	http.HandleFunc("/movie", handlers.MovieDetailHandler)
	http.HandleFunc("/signup", handlers.SignupHandler)
	http.HandleFunc("/auth/google/signup", handlers.GoogleSignupHandler)
	http.HandleFunc("/terms", handlers.TermsHandler)
	http.HandleFunc("/privacy-policy", handlers.PrivacyPolicyHandler)
	http.HandleFunc("/auth/google/login", handlers.GoogleLoginHandler)
	http.HandleFunc("/auth/google/callback", handlers.GoogleCallbackHandler)
	http.HandleFunc("/login", handlers.LoginHandler)
	http.HandleFunc("/forgot-password", handlers.ForgotPasswordHandler)
	http.HandleFunc("/verify-code", handlers.VerificationCodeHandler)
	http.HandleFunc("/reset-password", handlers.ResetPasswordHandler)
	http.HandleFunc("/dashboard", handlers.DashBoardHandler)
	http.HandleFunc("/series", handlers.SeriesPageHandler)
	http.HandleFunc("/dashboard/series/cards", handlers.SeriesCardsHandler)
	http.HandleFunc("/movies", handlers.MoviesPageHandler)
	http.HandleFunc("/movies/cards", handlers.MoviesCardsHandler)
	http.HandleFunc("/anime", handlers.AnimePageHandler)
	http.HandleFunc("/dashboard/anime/cards", handlers.AnimeCardsHandler)

	//Explore page routes
	http.HandleFunc("/explore", handlers.ExplorePageHandler)
	http.HandleFunc("/person", handlers.PersonPageHandler)

	http.HandleFunc("/api/explore/state", handlers.ExploreStateAPI)
	http.HandleFunc("/api/explore/watchlist", handlers.ExploreWatchlistAPI)
	http.HandleFunc("/api/explore/like", handlers.ExploreLikeAPI)
	http.HandleFunc("/api/explore/rating", handlers.ExploreRatingAPI)
	http.HandleFunc("/api/explore/review", handlers.ExploreReviewAPI)
	http.HandleFunc("/api/explore/watch-event", handlers.ExploreWatchEventAPI)
	http.HandleFunc("/api/explore/collections", handlers.ExploreCollectionsAPI)
	http.HandleFunc("/api/explore/collection-items", handlers.ExploreCollectionItemsAPI)
	http.HandleFunc("/api/explore/keyword-movies", handlers.ExploreKeywordMoviesAPI)
	http.HandleFunc("/search", handlers.SearchPageHandler)
	http.HandleFunc("/api/search/suggestions", handlers.SearchSuggestionsHandler)
	http.HandleFunc("/api/profile", handlers.ProfileCardHandler)
	http.HandleFunc("/logout", handlers.ProfileLogoutHandler)
	http.HandleFunc("/community", handlers.CommunityPageHandler)
	http.HandleFunc("/api/community/users", handlers.CommunityUsersHandler)
	http.HandleFunc("/api/community/user", handlers.CommunityUserProfileHandler)
	http.HandleFunc("/api/community/friend", handlers.CommunityFriendMarkHandler)
	http.HandleFunc("/api/profile/marks", handlers.ProfileMarksHandler)

	http.HandleFunc("/community/chat", handlers.CommunityChatFragmentHandler)

	http.HandleFunc("/api/community/chat/messages", handlers.CommunityChatMessagesHandler)
	http.HandleFunc("/api/community/chat/events", handlers.CommunityChatEventsHandler)
	http.HandleFunc("/api/community/chat/reaction", handlers.CommunityChatReactionHandler)
	http.HandleFunc("/api/community/chat/upload", handlers.CommunityChatUploadHandler)
	http.HandleFunc("/api/community/chat/movies", handlers.CommunityChatMovieSearchHandler)

	http.HandleFunc("/community-media/", handlers.CommunityChatMediaHandler)

	http.HandleFunc("/api/explore/personal/watchlist", handlers.ExplorePersonalWatchlistAPI)
	http.HandleFunc("/api/explore/personal/history", handlers.ExplorePersonalHistoryAPI)
	http.HandleFunc("/api/explore/personal/ratings", handlers.ExplorePersonalRatingsAPI)

	//collection template routes

	http.HandleFunc("/api/explore/collection-hub", handlers.ExploreCommunityCollectionHubAPI)
	http.HandleFunc("/api/explore/collection-hub/folder", handlers.ExploreCommunityCollectionFolderAPI)
	http.HandleFunc("/api/explore/collection-hub/item", handlers.ExploreCommunityCollectionItemAPI)
	http.HandleFunc("/api/explore/collection-hub/friends", handlers.ExploreCommunityCollectionFriendsAPI)
	http.HandleFunc("/api/explore/collection-hub/share", handlers.ExploreCommunityCollectionShareAPI)
	http.HandleFunc("/api/explore/collection-hub/respond", handlers.ExploreCommunityCollectionRespondAPI)
	http.HandleFunc("/api/explore/collection-hub/shared-items", handlers.ExploreCommunityCollectionSharedItemsAPI)

	//chatroom features API route

	http.HandleFunc("/api/community/chat/presence", handlers.CommunityChatPresenceHandler)
	http.HandleFunc("/api/community/chat/members", handlers.CommunityChatMentionMembersHandler)
	http.HandleFunc("/api/community/chat/mentions", handlers.CommunityChatMentionsHandler)
	http.HandleFunc("/api/community/chat/mentions/read", handlers.CommunityChatMentionReadHandler)
	http.HandleFunc("/api/community/chat/reactions", handlers.CommunityChatReactionUsersHandler)

	storage.InitDatabase()
	fmt.Println(storage.RGBY("MoviPilot server running currently on http://localhost:8080"))
	http.ListenAndServe(":8080", nil)

}
