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

	storage.InitDatabase()
	fmt.Println(storage.RGBY("MoviPilot server running currently on http://localhost:8080"))
	http.ListenAndServe(":8080", nil)

}
