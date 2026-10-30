package main

import (
	"MoviPilot/funcs/storage"
	"MoviPilot/handlers"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	if err := handlers.RegisterAdminRoutes(
		http.DefaultServeMux,
		storage.DB,
		handlers.AdminConfigFromEnv(),
	); err != nil {
		log.Fatalf("MoviPilot admin setup failed: %v", err)
	}
	fmt.Println(storage.RGBY("MoviPilot server running currently on http://localhost:8080"))
	server := &http.Server{
		Addr:              ":8080",
		Handler:           handlers.AdminObservability(http.DefaultServeMux, storage.DB),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       90 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       90 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	go func() {
		log.Println("MoviPilot server listening on :8080")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("MoviPilot server stopped: %v", err)
		}
	}()

	<-shutdownContext.Done()

	shutdownTimeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownTimeout); err != nil {
		log.Printf("Graceful shutdown failed: %v", err)
	}
}
